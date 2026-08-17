import {
  assertNonNegativeMoney,
  compareMoney,
  multiplyRatio,
  sumMoney,
  zeroMoney,
} from "./money.mjs";
import {
  isWithinValidity,
  quoteInstallment,
  validatePlanForOperation,
} from "./financing.mjs";
import {
  promotionBenefits,
  selectActivePromotions,
} from "./promotions.mjs";

export const ENGINE_VERSION = "jda-domain-1.0.0";

const STATUS_RANK = Object.freeze({
  reachable_with_margin: 0,
  reachable_estimated: 1,
  close: 2,
  requires_evaluation: 3,
  unreachable_today: 4,
});

const SCENARIOS = Object.freeze(["low", "base", "high"]);
const CERTAINTY_RANK = Object.freeze({ T2: 3, T1: 2, T0: 1, no_trade_in: 0 });

function validateInput(input, snapshot) {
  for (const [name, value] of [
    ["cash", input.cash],
    ["accreditedDeposit", input.accreditedDeposit],
    ["maxMonthlyPayment", input.maxMonthlyPayment],
    ["vehicle.price", snapshot.vehicle.price],
    ["vehicle.financeableFees", snapshot.vehicle.financeableFees],
    ["vehicle.nonFinanceableFees", snapshot.vehicle.nonFinanceableFees],
  ]) {
    assertNonNegativeMoney(value, name);
  }
  if (!Array.isArray(input.acceptedTerms)) {
    throw new TypeError("acceptedTerms must be an array");
  }
  if (input.appraisal) {
    for (const scenario of SCENARIOS) {
      assertNonNegativeMoney(input.appraisal[scenario], `appraisal.${scenario}`);
    }
    if (
      compareMoney(input.appraisal.low, input.appraisal.base) > 0 ||
      compareMoney(input.appraisal.base, input.appraisal.high) > 0
    ) {
      throw new RangeError("Appraisal scenarios must satisfy low <= base <= high");
    }
  }
}

function validityFailure(snapshot, at) {
  const vehicle = snapshot.vehicle;
  if (!vehicle.available) return "vehicle_unavailable";
  if (!isWithinValidity(vehicle, at)) return "vehicle_snapshot_not_current";
  return null;
}

function evaluateScenario({
  scenario,
  input,
  ruleset,
  vehicle,
  promotions,
  benefits,
  effectivePrice,
  operationCost,
}) {
  const appraisal = input.appraisal?.[scenario] ?? zeroMoney(vehicle.price.currency);
  const availableContribution = sumMoney(
    [appraisal, benefits.tradeInBonus, input.cash, input.accreditedDeposit],
    vehicle.price.currency,
  );
  const contribution = availableContribution.min(operationCost);
  const allocation = allocateContribution(contribution, {
    appraisal,
    tradeInBonus: benefits.tradeInBonus,
    cash: input.cash,
    accreditedDeposit: input.accreditedDeposit,
  });
  const principal = operationCost.subtract(contribution).max(zeroMoney(vehicle.price.currency));
  const nonFinanceableCovered =
    compareMoney(contribution, vehicle.nonFinanceableFees) >= 0;
  const upfrontForVehicle = contribution
    .subtract(vehicle.nonFinanceableFees)
    .max(zeroMoney(vehicle.price.currency));
  const commonReasons = nonFinanceableCovered
    ? []
    : ["non_financeable_fees_not_covered"];

  if (principal.isZero() && commonReasons.length === 0) {
    return Object.freeze({
      scenario,
      eligible: true,
      reasons: Object.freeze([]),
      contribution,
      ...allocation,
      appraisal,
      principal,
      upfrontForVehicle,
      quote: Object.freeze({
        planId: null,
        planVersion: null,
        termMonths: 0,
        principal,
        installment: principal,
        totalRepayment: principal,
        pricingKind: "cash",
      }),
    });
  }

  const selectedPromotionIds = promotions.map((promotion) => promotion.id);
  const attempts = [];
  for (const plan of ruleset.plans) {
    for (const termMonths of plan.allowedTerms) {
      if (!input.acceptedTerms.includes(termMonths)) continue;
      let planPrincipal = principal;
      let planContribution = contribution;
      if (compareMoney(planPrincipal, plan.minAmount) < 0) {
        const contributionAtMinimum = operationCost
          .subtract(plan.minAmount)
          .max(zeroMoney(vehicle.price.currency));
        if (
          compareMoney(contributionAtMinimum, input.accreditedDeposit) >= 0 &&
          compareMoney(contributionAtMinimum, contribution) <= 0
        ) {
          planPrincipal = plan.minAmount;
          planContribution = contributionAtMinimum;
        }
      }
      const planAllocation = allocateContribution(planContribution, {
        appraisal,
        tradeInBonus: benefits.tradeInBonus,
        cash: input.cash,
        accreditedDeposit: input.accreditedDeposit,
      });
      const planNonFinanceableCovered =
        compareMoney(planContribution, vehicle.nonFinanceableFees) >= 0;
      const planUpfrontForVehicle = planContribution
        .subtract(vehicle.nonFinanceableFees)
        .max(zeroMoney(vehicle.price.currency));
      const reasons = [
        ...(planNonFinanceableCovered
          ? []
          : ["non_financeable_fees_not_covered"]),
        ...validatePlanForOperation({
          plan,
          at: input.at,
          vehicle,
          principal: planPrincipal,
          effectivePrice,
          upfrontForVehicle: planUpfrontForVehicle,
          selectedPromotionIds,
        }),
      ];
      let quote = null;
      if (reasons.length === 0) {
        try {
          quote = quoteInstallment(planPrincipal, plan, termMonths);
          if (compareMoney(quote.installment, input.maxMonthlyPayment) > 0) {
            reasons.push("monthly_payment_exceeded");
          }
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          reasons.push("pricing_not_available");
        }
      }
      attempts.push(
        Object.freeze({
          planId: plan.id,
          termMonths,
          eligible: reasons.length === 0,
          reasons: Object.freeze(reasons),
          quote,
          contribution: planContribution,
          ...planAllocation,
          principal: planPrincipal,
          upfrontForVehicle: planUpfrontForVehicle,
        }),
      );
    }
  }

  attempts.sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const leftTotal = left.quote?.totalRepayment.minorUnits ?? Number.MAX_SAFE_INTEGER;
    const rightTotal = right.quote?.totalRepayment.minorUnits ?? Number.MAX_SAFE_INTEGER;
    const leftPayment = left.quote?.installment.minorUnits ?? Number.MAX_SAFE_INTEGER;
    const rightPayment = right.quote?.installment.minorUnits ?? Number.MAX_SAFE_INTEGER;
    return (
      leftTotal - rightTotal ||
      leftPayment - rightPayment ||
      left.termMonths - right.termMonths ||
      left.planId.localeCompare(right.planId)
    );
  });
  const winner = attempts.find((attempt) => attempt.eligible);
  return Object.freeze({
    scenario,
    eligible: Boolean(winner),
    reasons: winner
      ? Object.freeze([])
      : Object.freeze([...new Set(attempts.flatMap((attempt) => attempt.reasons))]),
    contribution: winner?.contribution ?? contribution,
    appraisalApplied: winner?.appraisalApplied ?? allocation.appraisalApplied,
    tradeInBonusApplied:
      winner?.tradeInBonusApplied ?? allocation.tradeInBonusApplied,
    cashUsed: winner?.cashUsed ?? allocation.cashUsed,
    accreditedDepositUsed:
      winner?.accreditedDepositUsed ?? allocation.accreditedDepositUsed,
    appraisal,
    principal: winner?.principal ?? principal,
    upfrontForVehicle: winner?.upfrontForVehicle ?? upfrontForVehicle,
    quote: winner?.quote ?? null,
  });
}

function allocateContribution(target, sources) {
  let remaining = target;
  const take = (available) => {
    const used = available.min(remaining);
    remaining = remaining.subtract(used);
    return used;
  };
  const accreditedDepositUsed = take(sources.accreditedDeposit);
  const appraisalApplied = take(sources.appraisal);
  const tradeInBonusApplied = take(sources.tradeInBonus);
  const cashUsed = take(sources.cash);
  if (!remaining.isZero()) {
    throw new RangeError("Contribution allocation exceeds available funds");
  }
  return Object.freeze({
    appraisalApplied,
    tradeInBonusApplied,
    cashUsed,
    accreditedDepositUsed,
  });
}

function classify(scenarios, input, ruleset) {
  const appraisalNeedsReview =
    input.appraisal &&
    (input.appraisal.requiresReview ||
      Date.parse(input.at) >= Date.parse(input.appraisal.validUntil));
  const low = scenarios.find((result) => result.scenario === "low");
  const base = scenarios.find((result) => result.scenario === "base");
  const high = scenarios.find((result) => result.scenario === "high");

  if (appraisalNeedsReview && !scenarioWithoutTradeIsEnough(input, low)) {
    return "requires_evaluation";
  }
  if (low.eligible) {
    const installment = low.quote.installment;
    const requiredMargin = multiplyRatio(
      input.maxMonthlyPayment,
      ruleset.comfortablePaymentMarginBps,
      10_000,
      "up",
    );
    const actualMargin = input.maxMonthlyPayment.subtract(installment);
    return compareMoney(actualMargin, requiredMargin) >= 0
      ? "reachable_with_margin"
      : "reachable_estimated";
  }
  if (base.eligible) return "reachable_estimated";
  if (high.eligible) return "close";
  return "unreachable_today";
}

function scenarioWithoutTradeIsEnough(input, scenario) {
  if (!scenario?.eligible) return false;
  const withoutTrade = input.cash.add(input.accreditedDeposit);
  return compareMoney(withoutTrade, scenario.contribution) >= 0;
}

function selectedScenario(status, scenarios) {
  const preferred =
    status === "reachable_with_margin"
      ? "low"
      : status === "reachable_estimated"
        ? scenarios.find((item) => item.scenario === "low")?.eligible
          ? "low"
          : "base"
        : status === "close"
          ? "high"
          : "base";
  return scenarios.find((item) => item.scenario === preferred);
}

export function evaluateOperation(input, ruleset, snapshot) {
  validateInput(input, snapshot);
  const vehicle = snapshot.vehicle;
  const invalidVehicleReason = validityFailure(snapshot, input.at);
  const promotions = selectActivePromotions(
    snapshot.promotions ?? [],
    vehicle.id,
    input.at,
  );
  const benefits = promotionBenefits(
    promotions,
    vehicle.price,
    Boolean(input.appraisal),
  );
  const effectivePrice = vehicle.price.subtract(benefits.priceDiscount);
  const operationCost = sumMoney(
    [effectivePrice, vehicle.financeableFees, vehicle.nonFinanceableFees],
    vehicle.price.currency,
  );

  const scenarios = SCENARIOS.map((scenario) =>
    evaluateScenario({
      scenario,
      input,
      ruleset,
      vehicle,
      promotions,
      benefits,
      effectivePrice,
      operationCost,
    }),
  );
  let status = classify(scenarios, input, ruleset);
  if (invalidVehicleReason) status = "unreachable_today";
  const chosen = selectedScenario(status, scenarios);
  const reasons = invalidVehicleReason
    ? [invalidVehicleReason]
    : chosen.eligible
      ? []
      : chosen.reasons.length > 0
        ? chosen.reasons
        : ["no_eligible_financing_plan"];

  return Object.freeze({
    engineVersion: ENGINE_VERSION,
    rulesetVersion: ruleset.version,
    evaluatedAt: input.at,
    vehicleId: vehicle.id,
    status,
    certainty: input.appraisal?.certainty ?? "no_trade_in",
    appliedPromotionIds: Object.freeze(promotions.map((promotion) => promotion.id)),
    reasons: Object.freeze(reasons),
    assumptions: Object.freeze([
      "preliminary_simulation",
      "subject_to_trade_in_inspection",
      "subject_to_document_and_credit_review",
      "subject_to_vehicle_availability",
    ]),
    breakdown: Object.freeze({
      listedPrice: vehicle.price,
      priceDiscount: benefits.priceDiscount,
      effectivePrice,
      financeableFees: vehicle.financeableFees,
      nonFinanceableFees: vehicle.nonFinanceableFees,
      operationCost,
      appraisal: chosen.appraisal,
      appraisalApplied: chosen.appraisalApplied,
      tradeInBonus: benefits.tradeInBonus,
      tradeInBonusApplied: chosen.tradeInBonusApplied,
      cashAvailable: input.cash,
      cashUsed: chosen.cashUsed,
      accreditedDeposit: input.accreditedDeposit,
      accreditedDepositUsed: chosen.accreditedDepositUsed,
      contribution: chosen.contribution,
      principal: chosen.principal,
      planId: chosen.quote?.planId ?? null,
      planVersion: chosen.quote?.planVersion ?? null,
      termMonths: chosen.quote?.termMonths ?? null,
      installment: chosen.quote?.installment ?? null,
      totalRepayment: chosen.quote?.totalRepayment ?? null,
    }),
    scenarioResults: Object.freeze(scenarios),
    validUntil: earliestValidity([
      vehicle.validUntil,
      ...promotions.map((promotion) => promotion.validUntil),
      chosen.quote?.planId
        ? ruleset.plans.find((plan) => plan.id === chosen.quote.planId)?.validUntil
        : null,
    ]),
  });
}

function earliestValidity(values) {
  return values
    .filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

export function evaluateInventory(input, ruleset, snapshots) {
  return Object.freeze(
    snapshots
      .map((snapshot) => {
        const evaluation = evaluateOperation(input, ruleset, snapshot);
        const item = { snapshot, evaluation };
        return Object.freeze({
          ...item,
          rankSignals: rankSignals(item, input),
        });
      })
      .sort(rankEvaluations),
  );
}

function rankEvaluations(left, right) {
  const statusDifference =
    left.rankSignals.statusRank - right.rankSignals.statusRank;
  if (statusDifference !== 0) return statusDifference;
  return (
    right.rankSignals.certaintyRank - left.rankSignals.certaintyRank ||
    right.rankSignals.preferenceScore - left.rankSignals.preferenceScore ||
    right.rankSignals.monthlyMarginMinor - left.rankSignals.monthlyMarginMinor ||
    left.rankSignals.financeRatioBps - right.rankSignals.financeRatioBps ||
    right.rankSignals.freshnessEpochMs - left.rankSignals.freshnessEpochMs ||
    Number(right.rankSignals.hasActivePromotion) -
      Number(left.rankSignals.hasActivePromotion) ||
    left.snapshot.vehicle.id.localeCompare(right.snapshot.vehicle.id)
  );
}

function rankSignals(item, input) {
  const { evaluation, snapshot } = item;
  const installment = evaluation.breakdown.installment;
  const effectivePrice = evaluation.breakdown.effectivePrice;
  const principal = evaluation.breakdown.principal;
  const financeRatioBps = effectivePrice.isZero()
    ? 0
    : Number(
        (BigInt(principal.minorUnits) * 10_000n) /
          BigInt(effectivePrice.minorUnits),
      );
  return Object.freeze({
    statusRank: STATUS_RANK[evaluation.status],
    certaintyRank: CERTAINTY_RANK[evaluation.certainty] ?? 0,
    preferenceScore: preferenceScore(snapshot.vehicle, input.preferences ?? {}),
    monthlyMarginMinor: installment
      ? input.maxMonthlyPayment.subtract(installment).minorUnits
      : Number.MIN_SAFE_INTEGER,
    financeRatioBps,
    freshnessEpochMs: Date.parse(snapshot.vehicle.updatedAt),
    hasActivePromotion: evaluation.appliedPromotionIds.length > 0,
  });
}

function preferenceScore(vehicle, preferences) {
  let score = 0;
  if (preferences.preferredBrands?.includes(vehicle.brand)) score += 2;
  if (preferences.preferredVehicleTypes?.includes(vehicle.type)) score += 1;
  return score;
}
