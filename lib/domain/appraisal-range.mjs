/**
 * Rango preliminar de toma de un usado.
 *
 * No cierra una tasación: reduce incertidumbre para que la visita llegue mejor
 * calificada. Por eso el resultado siempre viaja como preliminar, sujeto a
 * revisión física y documental, y con el detalle de cómo se armó.
 *
 * La referencia sale de un tarifario de tasación **versionado y cargado por el
 * equipo** (`appraisal_rule_set`). No se raspan sitios de terceros: un número
 * que se le muestra a un cliente tiene que poder auditarse y sostenerse, y un
 * precio tomado de un aviso ajeno no cumple ninguna de las dos cosas.
 */

export const APPRAISAL_RANGE_SCHEMA_VERSION = "jda-appraisal-range.v1";

/** Amplitud del rango según cuánta evidencia hay. T0 = todo declarado. */
export const DEFAULT_SPREAD_BPS = Object.freeze({ T0: 1_500, T1: 800 });

export class AppraisalRangeError extends Error {
  constructor(code, message, field = null) {
    super(message);
    this.name = "AppraisalRangeError";
    this.code = code;
    this.field = field;
  }
}

function invalid(message, field) {
  throw new AppraisalRangeError("invalid_ruleset", message, field);
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function integer(value, field, { min, max }) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    invalid(`${field} no es válido.`, field);
  }
  return numeric;
}

/**
 * Valida el tarifario de tasación. Un tarifario incompleto se rechaza acá y no
 * cuando ya se le mostró un número a alguien.
 */
export function normalizeAppraisalRuleset(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("El tarifario de tasación es obligatorio.", "ruleset");
  }
  const currency = String(input.currency ?? "ARS").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid("La moneda no es válida.", "currency");
  const references = Array.isArray(input.references) ? input.references : [];
  if (references.length === 0) {
    invalid("El tarifario no tiene ninguna referencia cargada.", "references");
  }
  const map = new Map();
  for (const [index, reference] of references.entries()) {
    const make = normalizeText(reference?.make);
    const model = normalizeText(reference?.model);
    if (!make || !model) invalid(`La referencia ${index} no tiene marca o modelo.`, "references");
    const year = integer(reference?.year, `references[${index}].year`, { min: 1950, max: 2100 });
    const baseCents = integer(reference?.baseCents, `references[${index}].baseCents`, {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
    map.set(`${make}|${model}|${year}`, baseCents);
  }
  return Object.freeze({
    schemaVersion: APPRAISAL_RANGE_SCHEMA_VERSION,
    version: String(input.version ?? "sin-version"),
    currency,
    references: map,
    referenceKmPerYear: integer(input.referenceKmPerYear ?? 15_000, "referenceKmPerYear", {
      min: 1_000,
      max: 60_000,
    }),
    kmPenaltyBpsPer10k: integer(input.kmPenaltyBpsPer10k ?? 250, "kmPenaltyBpsPer10k", {
      min: 0,
      max: 2_000,
    }),
    maxKmPenaltyBps: integer(input.maxKmPenaltyBps ?? 3_000, "maxKmPenaltyBps", {
      min: 0,
      max: 8_000,
    }),
    // La referencia del tarifario es una unidad normal en buen estado: `GOOD`
    // es la línea de base y no ajusta nada.
    conditionAdjustBps: Object.freeze({
      EXCELLENT: 500,
      GOOD: 0,
      FAIR: -1_500,
      NEEDS_REPAIR: -3_000,
      ...(input.conditionAdjustBps ?? {}),
    }),
    spreadBps: Object.freeze({ ...DEFAULT_SPREAD_BPS, ...(input.spreadBps ?? {}) }),
  });
}

function applyBps(cents, bps) {
  return Math.round((cents * (10_000 + bps)) / 10_000);
}

/**
 * Calcula el rango preliminar.
 *
 * Se niega a estimar —no estima mal— cuando el tarifario no tiene esa unidad,
 * cuando el año no está cargado o cuando la unidad declara prenda: nada de eso
 * se puede resolver con una cuenta, y un número inventado ahí sale más caro que
 * no dar ninguno.
 */
export function estimateAppraisalRange(ruleset, vehicle, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const declaredYear = Number(vehicle?.year);
  const key = `${normalizeText(vehicle?.make)}|${normalizeText(vehicle?.model)}|${declaredYear}`;
  const baseReference = ruleset.references.get(key);

  if (vehicle?.hasLien === true) {
    return Object.freeze({
      estimable: false,
      reason: "LIEN_DECLARED",
      mensaje:
        "La unidad declara prenda: el rango lo define una persona después de revisar la documentación.",
      requiresReview: true,
    });
  }
  if (baseReference === undefined) {
    return Object.freeze({
      estimable: false,
      reason: "NO_REFERENCE",
      mensaje:
        "No tenemos referencia cargada para esa unidad y ese año: la tasa una persona.",
      requiresReview: true,
    });
  }

  const adjustments = [];
  let value = baseReference;

  const ageYears = Math.max(now.getUTCFullYear() - declaredYear, 0);
  const expectedKm = ageYears * ruleset.referenceKmPerYear;
  const declaredKm = Number(vehicle?.mileageKm);
  if (Number.isFinite(declaredKm) && declaredKm > expectedKm) {
    const excess = declaredKm - expectedKm;
    // Sólo penaliza el exceso. Menos kilómetros de los esperados no suma: un
    // premio por kilometraje bajo necesitaría verlo, no creerlo.
    const penalty = -Math.min(
      Math.round((excess / 10_000) * ruleset.kmPenaltyBpsPer10k),
      ruleset.maxKmPenaltyBps,
    );
    if (penalty !== 0) {
      value = applyBps(value, penalty);
      adjustments.push({
        concepto: "kilometraje",
        bps: penalty,
        detalle: `${declaredKm.toLocaleString("es-AR")} km contra ${expectedKm.toLocaleString("es-AR")} esperados`,
      });
    }
  }

  const condition = String(vehicle?.declaredCondition ?? "GOOD").toUpperCase();
  const conditionBps = ruleset.conditionAdjustBps[condition];
  if (conditionBps === undefined) {
    return Object.freeze({
      estimable: false,
      reason: "UNKNOWN_CONDITION",
      mensaje: "El estado declarado no está previsto en el tarifario.",
      requiresReview: true,
    });
  }
  if (conditionBps !== 0) {
    value = applyBps(value, conditionBps);
    adjustments.push({
      concepto: "estado declarado",
      bps: conditionBps,
      detalle: `estado ${condition}, declarado por el propietario`,
    });
  }

  const certainty = options.certainty === "T1" ? "T1" : "T0";
  const spread = ruleset.spreadBps[certainty] ?? DEFAULT_SPREAD_BPS.T0;

  return Object.freeze({
    estimable: true,
    schemaVersion: APPRAISAL_RANGE_SCHEMA_VERSION,
    currency: ruleset.currency,
    lowCents: applyBps(value, -spread),
    baseCents: value,
    highCents: applyBps(value, spread),
    certainty,
    // Nunca es una tasación cerrada: la unidad no se vio.
    requiresReview: true,
    aviso:
      "Rango preliminar sobre datos declarados. Queda sujeto a revisión física y documental.",
    basis: Object.freeze({
      rulesetVersion: ruleset.version,
      referenciaCents: baseReference,
      ajustes: Object.freeze(adjustments.map((row) => Object.freeze(row))),
      spreadBps: spread,
    }),
  });
}
