import {
  Money,
  moneyFromMajor,
  moneyFromMinor,
  zeroMoney,
} from "../domain/index.mjs";
import { ApplicationContractError } from "./contracts.mjs";

const VEHICLE_TYPES = Object.freeze({
  car: "car",
  auto: "car",
  sedan: "car",
  sedán: "car",
  hatchback: "car",
  suv: "suv",
  pickup: "pickup",
  "pick-up": "pickup",
  camioneta: "pickup",
});

function contractError(code, message, field, details = null) {
  throw new ApplicationContractError(code, message, field, details);
}

export function normalizeIsoDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    contractError("invalid_date", `La fecha ${field} no es válida.`, field);
  }
  return date.toISOString();
}

export function normalizeArs(value, field, unit = "major") {
  try {
    if (value instanceof Money) {
      if (value.currency !== "ARS") throw new RangeError("Expected ARS");
      return value;
    }
    if (value && typeof value === "object" && "minorUnits" in value) {
      if ((value.currency ?? "ARS") !== "ARS") {
        throw new RangeError("Expected ARS");
      }
      const minor = value.minorUnits;
      if (
        (typeof minor !== "number" &&
          typeof minor !== "bigint" &&
          typeof minor !== "string") ||
        (typeof minor === "string" && !/^-?\d+$/.test(minor))
      ) {
        throw new TypeError("Invalid minor units");
      }
      return moneyFromMinor(
        typeof minor === "string" ? BigInt(minor) : minor,
        "ARS",
      );
    }
    if (unit === "minor") {
      if (
        (typeof value !== "number" && typeof value !== "bigint") ||
        (typeof value === "number" && !Number.isSafeInteger(value))
      ) {
        throw new TypeError("Minor units must be an integer");
      }
      return moneyFromMinor(value, "ARS");
    }
    return moneyFromMajor(value, "ARS");
  } catch (error) {
    contractError("invalid_money", `El importe ${field} no es ARS válido.`, field, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function firstDefined(record, candidates) {
  for (const candidate of candidates) {
    if (record[candidate.key] !== undefined && record[candidate.key] !== null) {
      return { value: record[candidate.key], ...candidate };
    }
  }
  return null;
}

function recordMoney(record, candidates, field, fallback = null) {
  const found = firstDefined(record, candidates);
  if (!found) {
    if (fallback) return fallback;
    contractError("missing_money", `Falta el importe ${field}.`, field);
  }
  return normalizeArs(found.value, field, found.unit);
}

function normalizeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    contractError("invalid_integer", `${field} debe ser un entero válido.`, field);
  }
  return value;
}

function normalizeTerms(value, field) {
  let terms = value;
  if (typeof terms === "string") {
    try {
      terms = JSON.parse(terms);
    } catch {
      contractError("invalid_terms", `${field} no contiene plazos válidos.`, field);
    }
  }
  if (!Array.isArray(terms) || terms.length === 0) {
    contractError("invalid_terms", `${field} debe contener al menos un plazo.`, field);
  }
  return Object.freeze(
    [...new Set(terms.map((term) => normalizeInteger(term, field, 1)))].sort(
      (left, right) => left - right,
    ),
  );
}

export function normalizeSearchRequest(request, clock) {
  if (!request || typeof request !== "object") {
    contractError("invalid_request", "La búsqueda es obligatoria.", "request");
  }
  const evaluatedAt = normalizeIsoDate(
    request.evaluatedAt ?? request.at ?? clock(),
    "evaluatedAt",
  );
  const appraisal = request.appraisal
    ? normalizeAppraisal(request.appraisal, evaluatedAt)
    : null;
  return Object.freeze({
    at: evaluatedAt,
    cash: requestMoney(request, "cash", true),
    accreditedDeposit: requestMoney(request, "accreditedDeposit", true),
    maxMonthlyPayment: requestMoney(request, "maxMonthlyPayment", false),
    acceptedTerms: normalizeTerms(request.acceptedTerms, "acceptedTerms"),
    appraisal,
    preferences: normalizePreferences(request.preferences),
  });
}

function requestMoney(request, name, allowDefault) {
  const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;
  const found = firstDefined(request, [
    { key: name, unit: "major" },
    { key: `${name}Ars`, unit: "major" },
    { key: `${name}Cents`, unit: "minor" },
    { key: `${capitalized}Ars`, unit: "major" },
  ]);
  if (!found) {
    if (allowDefault) return zeroMoney("ARS");
    contractError("missing_money", `Falta el importe ${name}.`, name);
  }
  return normalizeArs(found.value, name, found.unit);
}

function normalizeAppraisal(appraisal, evaluatedAt) {
  const scenario = (name) =>
    recordMoney(
      appraisal,
      [
        { key: name, unit: "major" },
        { key: `${name}Ars`, unit: "major" },
        { key: `${name}Cents`, unit: "minor" },
      ],
      `appraisal.${name}`,
    );
  return Object.freeze({
    low: scenario("low"),
    base: scenario("base"),
    high: scenario("high"),
    certainty: appraisal.certainty ?? appraisal.certaintyLevel ?? "T0",
    requiresReview: Boolean(appraisal.requiresReview),
    validUntil: normalizeIsoDate(
      appraisal.validUntil ?? addMinutes(evaluatedAt, 60),
      "appraisal.validUntil",
    ),
  });
}

function normalizePreferences(preferences = {}) {
  const strings = (value) =>
    Object.freeze(
      Array.isArray(value)
        ? [...new Set(value.filter((item) => typeof item === "string"))]
        : [],
    );
  return Object.freeze({
    preferredBrands: strings(preferences.preferredBrands),
    preferredVehicleTypes: Object.freeze(
      strings(preferences.preferredVehicleTypes).map(normalizeVehicleType),
    ),
  });
}

export function normalizeVehicleRecord(record, context) {
  const updatedAt = normalizeIsoDate(
    record.updatedAt ??
      record.lastSyncedAt ??
      record.publishedAt ??
      context.evaluatedAt,
    `vehicle.${record.id}.updatedAt`,
  );
  const validFrom = normalizeIsoDate(
    record.validFrom ?? record.publishedAt ?? updatedAt,
    `vehicle.${record.id}.validFrom`,
  );
  const validUntil = normalizeIsoDate(
    record.validUntil ?? addMinutes(updatedAt, context.stockFreshnessMinutes),
    `vehicle.${record.id}.validUntil`,
  );
  const currency = record.currency ?? record.price?.currency ?? "ARS";
  if (currency !== "ARS") {
    contractError(
      "unsupported_currency",
      "La V1 solo admite vehículos publicados en ARS.",
      `vehicle.${record.id}.currency`,
    );
  }
  return Object.freeze({
    id: requiredString(record.id, "vehicle.id"),
    version: requiredString(
      String(record.version ?? record.updatedAt ?? record.lastSyncedAt ?? updatedAt),
      "vehicle.version",
    ),
    slug: requiredString(record.slug ?? record.id, "vehicle.slug"),
    brand: requiredString(record.brand ?? record.make, "vehicle.brand"),
    model: requiredString(
      [record.model, record.trim].filter(Boolean).join(" "),
      "vehicle.model",
    ),
    year: normalizeInteger(record.year, "vehicle.year", 1900),
    type: normalizeVehicleType(record.type ?? record.bodyType ?? "car"),
    available:
      typeof record.available === "boolean"
        ? record.available
        : (record.status ?? "AVAILABLE") === "AVAILABLE",
    price: recordMoney(
      record,
      [
        { key: "price", unit: "major" },
        { key: "priceArs", unit: "major" },
        { key: "priceCents", unit: "minor" },
      ],
      `vehicle.${record.id}.price`,
    ),
    financeableFees: recordMoney(
      record,
      [
        { key: "financeableFees", unit: "major" },
        { key: "financeableFeesArs", unit: "major" },
        { key: "financeableFeesCents", unit: "minor" },
      ],
      `vehicle.${record.id}.financeableFees`,
      zeroMoney("ARS"),
    ),
    nonFinanceableFees: recordMoney(
      record,
      [
        { key: "nonFinanceableFees", unit: "major" },
        { key: "nonFinanceableFeesArs", unit: "major" },
        { key: "nonFinanceableFeesCents", unit: "minor" },
      ],
      `vehicle.${record.id}.nonFinanceableFees`,
      zeroMoney("ARS"),
    ),
    validFrom,
    validUntil,
    updatedAt,
  });
}

export function normalizePlanRecord(record, index = 0) {
  const id = requiredString(record.id ?? `plan-${index}`, "plan.id");
  const pricing = normalizePricing(record.pricing, id);
  return Object.freeze({
    id,
    version: requiredString(record.version ?? "1", `plan.${id}.version`),
    name: requiredString(record.name ?? id, `plan.${id}.name`),
    enabled: record.enabled !== false,
    validFrom: normalizeIsoDate(record.validFrom, `plan.${id}.validFrom`),
    validUntil: normalizeIsoDate(record.validUntil, `plan.${id}.validUntil`),
    allowedTerms: normalizeTerms(
      record.allowedTerms ?? record.allowedTermsJson,
      `plan.${id}.allowedTerms`,
    ),
    minAmount: recordMoney(
      record,
      [
        { key: "minAmount", unit: "major" },
        { key: "minAmountArs", unit: "major" },
        { key: "minAmountCents", unit: "minor" },
      ],
      `plan.${id}.minAmount`,
    ),
    maxAmount: recordMoney(
      record,
      [
        { key: "maxAmount", unit: "major" },
        { key: "maxAmountArs", unit: "major" },
        { key: "maxAmountCents", unit: "minor" },
      ],
      `plan.${id}.maxAmount`,
    ),
    maxFinanceRatioBps: normalizeInteger(
      record.maxFinanceRatioBps,
      `plan.${id}.maxFinanceRatioBps`,
    ),
    minimumDownPaymentRatioBps: normalizeInteger(
      record.minimumDownPaymentRatioBps,
      `plan.${id}.minimumDownPaymentRatioBps`,
    ),
    allowedVehicleTypes: Object.freeze(
      (record.allowedVehicleTypes ?? ["car", "suv", "pickup"]).map(
        normalizeVehicleType,
      ),
    ),
    maxVehicleAgeYears: normalizeInteger(
      record.maxVehicleAgeYears,
      `plan.${id}.maxVehicleAgeYears`,
    ),
    requiresPromotionId: record.requiresPromotionId ?? null,
    pricing,
  });
}

function normalizePricing(pricing, planId) {
  if (!pricing || typeof pricing !== "object") {
    contractError("invalid_pricing", "Falta el tarifario del plan.", `plan.${planId}.pricing`);
  }
  if (pricing.kind === "french") {
    return Object.freeze({
      kind: "french",
      monthlyRateBps: normalizeInteger(
        pricing.monthlyRateBps,
        `plan.${planId}.pricing.monthlyRateBps`,
      ),
    });
  }
  if (pricing.kind === "coefficient") {
    return Object.freeze({
      kind: "coefficient",
      installmentCoefficientPpm: normalizeInteger(
        pricing.installmentCoefficientPpm,
        `plan.${planId}.pricing.installmentCoefficientPpm`,
      ),
    });
  }
  if (pricing.kind === "table") {
    if (!Array.isArray(pricing.rows) || pricing.rows.length === 0) {
      contractError("invalid_pricing", "La tabla del plan está vacía.", `plan.${planId}.pricing.rows`);
    }
    return Object.freeze({
      kind: "table",
      rows: Object.freeze(
        pricing.rows.map((row, index) =>
          Object.freeze({
            termMonths: normalizeInteger(
              row.termMonths,
              `plan.${planId}.pricing.rows.${index}.termMonths`,
              1,
            ),
            fromAmount: recordMoney(
              row,
              [
                { key: "fromAmount", unit: "major" },
                { key: "fromAmountArs", unit: "major" },
                { key: "fromAmountCents", unit: "minor" },
              ],
              `plan.${planId}.pricing.rows.${index}.fromAmount`,
            ),
            toAmount: recordMoney(
              row,
              [
                { key: "toAmount", unit: "major" },
                { key: "toAmountArs", unit: "major" },
                { key: "toAmountCents", unit: "minor" },
              ],
              `plan.${planId}.pricing.rows.${index}.toAmount`,
            ),
            installmentCoefficientPpm: normalizeInteger(
              row.installmentCoefficientPpm,
              `plan.${planId}.pricing.rows.${index}.installmentCoefficientPpm`,
              1,
            ),
          }),
        ),
      ),
    });
  }
  contractError("invalid_pricing", "El tipo de tarifario no es compatible.", `plan.${planId}.pricing.kind`);
}

export function normalizePromotionRecord(record, index = 0) {
  const id = requiredString(record.id ?? `promotion-${index}`, "promotion.id");
  return Object.freeze({
    id,
    // D1 stores the optimistic-lock version as an integer, while the domain
    // contract treats all record versions as stable string identifiers.
    version: requiredString(String(record.version ?? "1"), `promotion.${id}.version`),
    state: String(record.state ?? record.status ?? "DRAFT").toUpperCase(),
    priority: normalizeInteger(record.priority ?? 0, `promotion.${id}.priority`),
    stackable: Boolean(record.stackable),
    vehicleIds: Object.freeze(record.vehicleIds ?? []),
    validFrom: normalizeIsoDate(
      record.validFrom ?? record.startsAt,
      `promotion.${id}.validFrom`,
    ),
    validUntil: normalizeIsoDate(
      record.validUntil ?? record.endsAt,
      `promotion.${id}.validUntil`,
    ),
    benefit: normalizePromotionBenefit(record, id),
  });
}

function normalizePromotionBenefit(record, id) {
  if (record.benefit?.kind === "financing_plan") {
    return Object.freeze({
      kind: "financing_plan",
      planId: requiredString(record.benefit.planId, `promotion.${id}.benefit.planId`),
    });
  }
  const type = String(record.type ?? record.benefit?.kind ?? "").toUpperCase();
  if (type === "FINANCING_SPECIAL" || type === "FINANCING_PLAN") {
    return Object.freeze({
      kind: "financing_plan",
      planId: requiredString(
        record.financingPlanId ?? record.planId,
        `promotion.${id}.planId`,
      ),
    });
  }
  if (type === "TRADE_IN_BONUS") {
    return Object.freeze({
      kind: "trade_in_bonus",
      amount: recordMoney(
        record.benefit ?? record,
        [
          { key: "amount", unit: "major" },
          { key: "amountArs", unit: "major" },
          { key: "tradeInBonusCents", unit: "minor" },
        ],
        `promotion.${id}.benefit.amount`,
      ),
    });
  }
  return Object.freeze({
    kind: "price_discount",
    amount: recordMoney(
      record.benefit ?? record,
      [
        { key: "amount", unit: "major" },
        { key: "amountArs", unit: "major" },
        { key: "discountCents", unit: "minor" },
      ],
      `promotion.${id}.benefit.amount`,
    ),
  });
}

function normalizeVehicleType(value) {
  const normalized = VEHICLE_TYPES[String(value).trim().toLowerCase()];
  if (!normalized) {
    contractError("invalid_vehicle_type", `Tipo de vehículo no admitido: ${value}.`, "vehicle.type");
  }
  return normalized;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    contractError("missing_string", `Falta ${field}.`, field);
  }
  return value.trim();
}

function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
