import { createSimulationSnapshot } from "@/lib/application/index.mjs";
import {
  ApiError,
  apiRoute,
  json,
  optionalString,
  publicCode,
  readJsonObject,
  requireIdempotencyKey,
  requiredInteger,
  requiredString,
} from "@/lib/server/api";
import {
  applicationDependencies,
  rethrowApplicationError,
} from "@/lib/server/affordability";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { simulationDto } from "@/lib/server/dto";

function acceptedTerms(payload: Record<string, unknown>): number[] {
  const value = payload.acceptedTerms;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 12 ||
    value.some((term) => !Number.isSafeInteger(term) || term < 1 || term > 120)
  ) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      acceptedTerms: "Los plazos deben expresarse en meses enteros.",
    });
  }
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

type MoneyDto = { currency: string; minorUnits: number };
type ApplicationSnapshot = {
  simulationCode: string;
  createdAt: string;
  expiresAt: string;
  engineVersion: string;
  rulesetVersion: string;
  disclaimers: string[];
  request: { cash: MoneyDto } & Record<string, unknown>;
  evaluation: {
    status: string;
    certainty: string;
    appliedPromotionIds: string[];
    breakdown: {
      listedPrice: MoneyDto;
      effectivePrice: MoneyDto;
      appraisalApplied: MoneyDto;
      tradeInBonus: MoneyDto;
      principal: MoneyDto;
      operationCost: MoneyDto;
      termMonths: number | null;
      installment: MoneyDto | null;
      totalRepayment: MoneyDto | null;
      planVersion: string | null;
    };
  };
};

function applicationSnapshot(value: unknown): ApplicationSnapshot {
  return value as ApplicationSnapshot;
}

export async function POST(request: Request): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    const vehicleSlug = requiredString(payload, "vehicleSlug", { min: 3, max: 120 });
    const appraisalCode = optionalString(payload, "appraisalCode", 40);
    const leadId = optionalString(payload, "leadId", 80);
    const cashCents = requiredInteger(payload, "cashCents", { min: 0 });
    const maxInstallmentCents = requiredInteger(payload, "maxInstallmentCents", { min: 0 });
    const terms = acceptedTerms(payload);
    const now = new Date();
    const access = getDataAccess();
    const vehicle = await access.stock.findBySlug(vehicleSlug);
    if (!vehicle) {
      throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    }
    if (vehicle.priceValidUntil && Date.parse(vehicle.priceValidUntil) <= now.getTime()) {
      throw new ApiError(409, "VEHICLE_PRICE_EXPIRED", "El precio cambió y debe consultarse nuevamente.");
    }
    if (leadId && !(await access.leads.findById(leadId))) {
      throw new ApiError(404, "LEAD_NOT_FOUND", "No encontramos el contacto asociado.");
    }
    const appraisal = appraisalCode
      ? await access.appraisals.findByPublicCode(appraisalCode)
      : null;
    if (appraisalCode && !appraisal) {
      throw new ApiError(404, "APPRAISAL_NOT_FOUND", "No encontramos la tasación indicada.");
    }
    const id = crypto.randomUUID();
    const simulationCode = publicCode("JD");
    const dependencies = await applicationDependencies(access, now);
    const usableAppraisal =
      appraisal &&
      appraisal.lowCents !== null &&
      appraisal.baseCents !== null &&
      appraisal.highCents !== null
        ? appraisal
        : null;
    let snapshot: ApplicationSnapshot;
    try {
      snapshot = applicationSnapshot(
        await createSimulationSnapshot(
          {
            evaluatedAt: now.toISOString(),
            vehicleId: vehicle.id,
            simulationCode,
            cashCents,
            accreditedDepositCents: 0,
            maxMonthlyPaymentCents: maxInstallmentCents,
            acceptedTerms: terms,
            ...(usableAppraisal
              ? {
                  appraisal: {
                    lowCents: usableAppraisal.lowCents,
                    baseCents: usableAppraisal.baseCents,
                    highCents: usableAppraisal.highCents,
                    certainty: usableAppraisal.certaintyLevel,
                    requiresReview:
                      !usableAppraisal.validUntil ||
                      Date.parse(usableAppraisal.validUntil) <= now.getTime(),
                    validUntil:
                      usableAppraisal.validUntil ??
                      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
                  },
                }
              : {}),
            ...(payload.preferences && typeof payload.preferences === "object"
              ? { preferences: payload.preferences }
              : {}),
          },
          dependencies,
        ),
      );
    } catch (error) {
      rethrowApplicationError(error);
    }
    const breakdown = snapshot.evaluation.breakdown;
    const simulation = await access.simulations.create({
      id,
      publicCode: snapshot.simulationCode,
      idempotencyKey,
      leadId,
      vehicleId: vehicle.id,
      appraisalId: appraisal?.id,
      promotionId: snapshot.evaluation.appliedPromotionIds[0],
      status: "ACTIVE",
      classification: snapshot.evaluation.status.toUpperCase(),
      certaintyLevel: snapshot.evaluation.certainty,
      vehiclePriceCents: breakdown.listedPrice.minorUnits,
      effectivePriceCents: breakdown.effectivePrice.minorUnits,
      appraisalAppliedCents: breakdown.appraisalApplied.minorUnits,
      tradeInBonusCents: breakdown.tradeInBonus.minorUnits,
      cashCents: snapshot.request.cash.minorUnits,
      financePrincipalCents: breakdown.principal.minorUnits,
      termMonths: breakdown.termMonths,
      installmentCents: breakdown.installment?.minorUnits,
      totalCostCents: breakdown.totalRepayment?.minorUnits ?? breakdown.operationCost.minorUnits,
      currency: vehicle.currency,
      engineVersion: snapshot.engineVersion,
      ruleVersion: snapshot.rulesetVersion,
      financePlanVersion: breakdown.planVersion,
      inputSnapshotJson: JSON.stringify(snapshot.request),
      resultSnapshotJson: JSON.stringify(snapshot),
      disclaimerSnapshot: snapshot.disclaimers.join(" "),
      expiresAt: snapshot.expiresAt,
    });
    const replayed = simulation.id !== id;
    return json(
      {
        data: simulationDto(simulation),
        meta: { ...sourceMeta(access.source), idempotencyReplayed: replayed },
      },
      {
        status: replayed ? 200 : 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
