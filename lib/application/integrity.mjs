import {
  APPLICATION_SCHEMA_VERSION,
  ApplicationContractError,
  immutableJsonDto,
  toJsonDto,
} from "./contracts.mjs";

const SELECTION_SCHEMA_VERSION = `${APPLICATION_SCHEMA_VERSION}.selection.v1`;

/**
 * Produces the public, replayable operation input from a normalized domain
 * request. Deliberately excludes evaluatedAt and every customer identifier.
 */
export function simulationInputFromNormalized(input) {
  return immutableJsonDto({
    cashCents: input.cash.minorUnits,
    accreditedDepositCents: input.accreditedDeposit.minorUnits,
    maxMonthlyPaymentCents: input.maxMonthlyPayment.minorUnits,
    acceptedTerms: input.acceptedTerms,
    appraisal: input.appraisal
      ? {
          lowCents: input.appraisal.low.minorUnits,
          baseCents: input.appraisal.base.minorUnits,
          highCents: input.appraisal.high.minorUnits,
          certainty: input.appraisal.certainty,
          requiresReview: input.appraisal.requiresReview,
          validUntil: input.appraisal.validUntil,
        }
      : null,
    preferences: input.preferences,
  });
}

/**
 * Hashes only server-normalized commercial inputs and records. evaluatedAt is
 * excluded so an unchanged selection can be confirmed on a later request.
 */
export async function createSelectionVersion({
  simulationInput,
  vehicle,
  ruleset,
  promotions,
  evaluation,
}) {
  const appliedPromotionIds = new Set(evaluation.appliedPromotionIds ?? []);
  const appliedPromotions = promotions.filter((promotion) =>
    appliedPromotionIds.has(promotion.id),
  );
  const stableEvaluation = Object.fromEntries(
    Object.entries(toJsonDto(evaluation)).filter(
      ([key]) => key !== "evaluatedAt",
    ),
  );
  return canonicalSha256({
    schemaVersion: SELECTION_SCHEMA_VERSION,
    simulationInput,
    vehicle: toJsonDto(vehicle),
    ruleset: toJsonDto(ruleset),
    promotions: toJsonDto(appliedPromotions),
    evaluation: stableEvaluation,
  });
}

export async function canonicalSha256(value) {
  const canonical = canonicalJson(toJsonDto(value));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ApplicationContractError(
      "selection_hash_unavailable",
      "No se pudo verificar la integridad de la operación.",
      "selectionVersion",
    );
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApplicationContractError(
        "invalid_selection_payload",
        "La selección contiene un número no válido.",
        "selectionVersion",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  throw new ApplicationContractError(
    "invalid_selection_payload",
    "La selección contiene datos no serializables.",
    "selectionVersion",
  );
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
