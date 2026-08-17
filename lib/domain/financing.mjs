import {
  assertNonNegativeMoney,
  compareMoney,
  internalMoneyMath,
  moneyFromMinor,
  multiplyRatio,
} from "./money.mjs";

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive integer`);
  }
}

export function isWithinValidity(subject, at) {
  const instant = Date.parse(at);
  const from = Date.parse(subject.validFrom);
  const until = Date.parse(subject.validUntil);
  if ([instant, from, until].some(Number.isNaN) || from >= until) {
    throw new RangeError("Invalid validity interval");
  }
  return instant >= from && instant < until;
}

/**
 * Quotes a principal using integer-only arithmetic.
 * Pricing kinds:
 * - french: monthlyRateBps is the monthly nominal rate in basis points.
 * - coefficient: installmentCoefficientPpm is cuota/principal in millionths.
 * - table: provider rows select a coefficient by term and principal band.
 */
export function quoteInstallment(principal, plan, termMonths) {
  assertNonNegativeMoney(principal, "principal");
  assertPositiveInteger(termMonths, "termMonths");
  if (!plan.allowedTerms.includes(termMonths)) {
    throw new RangeError(`Term ${termMonths} is not allowed by plan ${plan.id}`);
  }

  let installment;
  const pricing = plan.pricing;
  if (pricing.kind === "french") {
    installment = quoteFrench(
      principal,
      pricing.monthlyRateBps,
      termMonths,
    );
  } else if (pricing.kind === "coefficient") {
    installment = multiplyRatio(
      principal,
      pricing.installmentCoefficientPpm,
      1_000_000,
    );
  } else if (pricing.kind === "table") {
    const row = pricing.rows.find(
      (candidate) =>
        candidate.termMonths === termMonths &&
        principal.minorUnits >= candidate.fromAmount.minorUnits &&
        principal.minorUnits <= candidate.toAmount.minorUnits,
    );
    if (!row) {
      throw new RangeError("The provider table has no row for this operation");
    }
    installment = multiplyRatio(
      principal,
      row.installmentCoefficientPpm,
      1_000_000,
    );
  } else {
    throw new RangeError(`Unsupported pricing kind: ${pricing.kind}`);
  }

  return Object.freeze({
    planId: plan.id,
    planVersion: plan.version,
    termMonths,
    principal,
    installment,
    totalRepayment: multiplyRatio(installment, termMonths, 1),
    pricingKind: pricing.kind,
  });
}

export function quoteFrench(principal, monthlyRateBps, termMonths) {
  assertNonNegativeMoney(principal, "principal");
  assertPositiveInteger(termMonths, "termMonths");
  if (!Number.isSafeInteger(monthlyRateBps) || monthlyRateBps < 0) {
    throw new RangeError("monthlyRateBps must be a non-negative integer");
  }
  if (principal.isZero()) return principal;
  if (monthlyRateBps === 0) {
    return multiplyRatio(principal, 1, termMonths, "up");
  }

  const denominator = 10_000n;
  const growth = denominator + BigInt(monthlyRateBps);
  const growthPower = growth ** BigInt(termMonths);
  const denominatorPower = denominator ** BigInt(termMonths);
  const numerator =
    BigInt(principal.minorUnits) * BigInt(monthlyRateBps) * growthPower;
  const divisor = denominator * (growthPower - denominatorPower);
  return moneyFromMinor(
    internalMoneyMath.asSafeMinorUnits(
      internalMoneyMath.divide(numerator, divisor, "half-up"),
    ),
    principal.currency,
  );
}

export function validatePlanForOperation({
  plan,
  at,
  vehicle,
  principal,
  effectivePrice,
  upfrontForVehicle,
  selectedPromotionIds,
}) {
  const reasons = [];
  if (!plan.enabled) reasons.push("plan_disabled");
  if (!isWithinValidity(plan, at)) reasons.push("plan_not_current");
  if (
    plan.requiresPromotionId &&
    !selectedPromotionIds.includes(plan.requiresPromotionId)
  ) {
    reasons.push("required_promotion_not_applied");
  }
  if (!plan.allowedVehicleTypes.includes(vehicle.type)) {
    reasons.push("vehicle_type_not_allowed");
  }
  const vehicleAge = new Date(at).getUTCFullYear() - vehicle.year;
  if (vehicleAge < 0 || vehicleAge > plan.maxVehicleAgeYears) {
    reasons.push("vehicle_age_not_allowed");
  }
  if (compareMoney(principal, plan.minAmount) < 0) {
    reasons.push("below_minimum_finance_amount");
  }
  if (compareMoney(principal, plan.maxAmount) > 0) {
    reasons.push("above_maximum_finance_amount");
  }
  if (
    compareMoney(
      principal,
      multiplyRatio(effectivePrice, plan.maxFinanceRatioBps, 10_000, "down"),
    ) > 0
  ) {
    reasons.push("finance_ratio_exceeded");
  }
  if (
    compareMoney(
      upfrontForVehicle,
      multiplyRatio(
        effectivePrice,
        plan.minimumDownPaymentRatioBps,
        10_000,
        "up",
      ),
    ) < 0
  ) {
    reasons.push("minimum_down_payment_not_met");
  }
  return Object.freeze(reasons);
}
