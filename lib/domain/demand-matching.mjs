/**
 * Coincidencia entre una demanda registrada y una unidad del stock.
 *
 * El porcentaje no sale de un modelo ni de una intuición: se calcula sobre
 * criterios declarados por el comprador, con pesos fijos, y siempre viene
 * acompañado del detalle de qué criterio cumplió y cuál no. Un número sin ese
 * detalle no serviría para que un vendedor decida a quién llamar.
 */

export const DEMAND_SCHEMA_VERSION = "jda-demand.v1";

/** Pesos por criterio. Sólo pesan los criterios que el comprador declaró. */
export const DEMAND_WEIGHTS = Object.freeze({
  make: 30,
  model: 25,
  year: 15,
  price: 20,
  mileage: 10,
});

/** 10000 puntos básicos = 100 %. */
export const FULL_MATCH_BPS = 10_000;

export class DemandContractError extends Error {
  constructor(code, message, field = null) {
    super(message);
    this.name = "DemandContractError";
    this.code = code;
    this.field = field;
  }
}

function invalid(message, field) {
  throw new DemandContractError("invalid_demand", message, field);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function textList(value, field) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) invalid(`${field} debe ser una lista.`, field);
  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 60)
    .slice(0, 10);
  return Object.freeze([...new Set(items)]);
}

function optionalInteger(value, field, { min, max }) {
  if (value === undefined || value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    invalid(`${field} no es válido.`, field);
  }
  return numeric;
}

/**
 * Criterios de una demanda. Lo que el comprador no declaró queda en `null` y
 * no pesa: una demanda incompleta no penaliza a las unidades, sólo describe
 * menos.
 */
export function normalizeDemandCriteria(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("La demanda es obligatoria.", "criteria");
  }
  const currency = String(input.currency ?? "ARS").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid("La moneda no es válida.", "currency");

  const criteria = Object.freeze({
    schemaVersion: DEMAND_SCHEMA_VERSION,
    makes: textList(input.makes, "makes"),
    models: textList(input.models, "models"),
    types: textList(input.types, "types"),
    minYear: optionalInteger(input.minYear, "minYear", { min: 1950, max: 2100 }),
    // Un presupuesto de cero no es un presupuesto: se rechaza en lugar de
    // registrar una demanda que ninguna unidad puede cumplir.
    maxPriceCents: optionalInteger(input.maxPriceCents, "maxPriceCents", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    }),
    maxMileageKm: optionalInteger(input.maxMileageKm, "maxMileageKm", {
      min: 0,
      max: 3_000_000,
    }),
    currency,
    tradeIn: input.tradeIn === true,
    urgencyDays: optionalInteger(input.urgencyDays, "urgencyDays", { min: 0, max: 3650 }),
  });

  if (
    criteria.makes.length === 0 &&
    criteria.models.length === 0 &&
    criteria.types.length === 0 &&
    criteria.maxPriceCents === null
  ) {
    invalid(
      "Una demanda necesita al menos marca, modelo, tipo o presupuesto.",
      "criteria",
    );
  }
  return criteria;
}

function matchesAny(list, value) {
  if (list.length === 0) return null;
  const target = normalizeText(value);
  if (target.length === 0) return false;
  return list.some((item) => {
    const candidate = normalizeText(item);
    return target === candidate || target.includes(candidate) || candidate.includes(target);
  });
}

/**
 * Evalúa una unidad contra una demanda.
 *
 * Excluye —no puntúa bajo, excluye— cuando la unidad supera el presupuesto,
 * es más vieja que el año mínimo o está publicada en otra moneda que la
 * declarada: convertir moneda sin una cotización acordada sería inventar un
 * precio, y ofrecer algo que la persona no puede pagar es ruido, no una
 * coincidencia parcial.
 */
export function matchVehicleToDemand(criteria, vehicle) {
  if (!vehicle || typeof vehicle !== "object") invalid("La unidad es obligatoria.", "vehicle");
  const breakdown = [];
  const exclusions = [];
  let earned = 0;
  let possible = 0;

  const vehicleCurrency = String(vehicle.currency ?? "ARS").toUpperCase();
  const priceCents = Number(vehicle.priceCents ?? Number.NaN);

  if (criteria.maxPriceCents !== null) {
    let priceProblem = null;
    if (vehicleCurrency !== criteria.currency) {
      priceProblem = "CURRENCY_MISMATCH";
    } else if (!Number.isFinite(priceCents)) {
      priceProblem = "PRICE_UNKNOWN";
    } else if (priceCents > criteria.maxPriceCents) {
      priceProblem = "ABOVE_BUDGET";
    }
    if (priceProblem) exclusions.push(priceProblem);
    possible += DEMAND_WEIGHTS.price;
    if (!priceProblem) earned += DEMAND_WEIGHTS.price;
    breakdown.push({
      criterio: "precio",
      peso: DEMAND_WEIGHTS.price,
      cumple: priceProblem === null,
      detalle: priceProblem ?? "dentro del presupuesto declarado",
    });
  }

  const year = Number(vehicle.year ?? Number.NaN);
  if (criteria.minYear !== null) {
    possible += DEMAND_WEIGHTS.year;
    const ok = Number.isFinite(year) && year >= criteria.minYear;
    if (ok) earned += DEMAND_WEIGHTS.year;
    else exclusions.push("BELOW_MIN_YEAR");
    breakdown.push({
      criterio: "año",
      peso: DEMAND_WEIGHTS.year,
      cumple: ok,
      detalle: ok ? `${year} cumple el mínimo ${criteria.minYear}` : `${year} es anterior a ${criteria.minYear}`,
    });
  }

  const makeMatch = matchesAny(criteria.makes, vehicle.make);
  if (makeMatch !== null) {
    possible += DEMAND_WEIGHTS.make;
    if (makeMatch) earned += DEMAND_WEIGHTS.make;
    breakdown.push({
      criterio: "marca",
      peso: DEMAND_WEIGHTS.make,
      cumple: makeMatch,
      detalle: makeMatch ? `${vehicle.make} está entre las buscadas` : `${vehicle.make} no es una de las buscadas`,
    });
  }

  const modelMatch = matchesAny(criteria.models, vehicle.model);
  if (modelMatch !== null) {
    possible += DEMAND_WEIGHTS.model;
    if (modelMatch) earned += DEMAND_WEIGHTS.model;
    breakdown.push({
      criterio: "modelo",
      peso: DEMAND_WEIGHTS.model,
      cumple: modelMatch,
      detalle: modelMatch ? `${vehicle.model} coincide` : `${vehicle.model} no coincide`,
    });
  }

  const mileage = Number(vehicle.mileageKm ?? Number.NaN);
  if (criteria.maxMileageKm !== null) {
    possible += DEMAND_WEIGHTS.mileage;
    // El kilometraje puntúa pero no excluye: una unidad con más kilómetros
    // sigue siendo una conversación posible, y el vendedor ve por qué bajó.
    const ok = Number.isFinite(mileage) && mileage <= criteria.maxMileageKm;
    if (ok) earned += DEMAND_WEIGHTS.mileage;
    breakdown.push({
      criterio: "kilometraje",
      peso: DEMAND_WEIGHTS.mileage,
      cumple: ok,
      detalle: ok
        ? `${mileage} km dentro del máximo`
        : `${mileage} km supera el máximo de ${criteria.maxMileageKm}`,
    });
  }

  const eligible = exclusions.length === 0;
  const scoreBps =
    possible === 0 ? 0 : Math.round((earned / possible) * FULL_MATCH_BPS);

  return Object.freeze({
    eligible,
    // Una unidad excluida no lleva porcentaje: no es una coincidencia peor,
    // no es una coincidencia.
    scoreBps: eligible ? scoreBps : 0,
    breakdown: Object.freeze(breakdown.map((row) => Object.freeze(row))),
    exclusions: Object.freeze([...new Set(exclusions)]),
  });
}

/**
 * Compradores que podrían estar interesados en una unidad que acaba de entrar,
 * ordenados por coincidencia. Sólo demandas vigentes y abiertas.
 */
export function rankDemandsForVehicle(demands, vehicle, options = {}) {
  const minScoreBps = Number.isFinite(options.minScoreBps) ? options.minScoreBps : 6_000;
  const now = options.now instanceof Date ? options.now : new Date();
  const results = [];
  for (const demand of demands ?? []) {
    if (demand.status !== "OPEN") continue;
    if (Date.parse(demand.validUntil) <= now.getTime()) continue;
    const evaluation = matchVehicleToDemand(demand.criteria, vehicle);
    if (!evaluation.eligible) continue;
    if (evaluation.scoreBps < minScoreBps) continue;
    results.push(Object.freeze({ demandId: demand.id, leadId: demand.leadId, ...evaluation }));
  }
  return Object.freeze(
    results.sort((left, right) => right.scoreBps - left.scoreBps),
  );
}
