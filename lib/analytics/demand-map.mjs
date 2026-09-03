/**
 * Mapa de demanda real.
 *
 * Cuenta lo que la gente declaró y nada más. Una demanda que no dijo
 * presupuesto no se reparte en un rango "probable" ni se estima: se cuenta
 * aparte, como no declarada. El tablero sirve para decidir qué unidades tomar,
 * y una cifra inventada ahí se paga comprando el auto equivocado.
 */

export const DEMAND_MAP_SCHEMA_VERSION = "jda-demand-map.v1";

/** Días dentro de los cuales una compra se considera inminente. */
export const READY_TO_BUY_DAYS = 7;

function bucketKey(currency, fromMajor, toMajor) {
  return toMajor === null
    ? `${currency}:${fromMajor}+`
    : `${currency}:${fromMajor}-${toMajor}`;
}

function bucketLabel(currency, fromMajor, toMajor) {
  const format = (value) => value.toLocaleString("es-AR");
  return toMajor === null
    ? `más de ${currency} ${format(fromMajor)}`
    : `${currency} ${format(fromMajor)} a ${format(toMajor)}`;
}

/**
 * Rangos por moneda. Son tramos fijos y declarados, no cuantiles calculados
 * sobre la muestra: dos lecturas del tablero en días distintos tienen que ser
 * comparables entre sí.
 */
const RANGES = Object.freeze({
  USD: Object.freeze([5_000, 10_000, 15_000, 20_000, 30_000, 50_000]),
  ARS: Object.freeze([5_000_000, 10_000_000, 20_000_000, 30_000_000, 50_000_000, 80_000_000]),
});

function rangeFor(currency, maxPriceMajor) {
  const edges = RANGES[currency] ?? RANGES.ARS;
  for (let index = 0; index < edges.length; index += 1) {
    if (maxPriceMajor <= edges[index]) {
      const from = index === 0 ? 0 : edges[index - 1];
      return { from, to: edges[index] };
    }
  }
  return { from: edges[edges.length - 1], to: null };
}

function increment(map, key, seed) {
  const current = map.get(key);
  if (current) {
    current.personas += 1;
    return current;
  }
  const row = { ...seed, personas: 1 };
  map.set(key, row);
  return row;
}

/**
 * Construye el tablero a partir de las demandas abiertas y vigentes.
 *
 * @param {ReadonlyArray<{id: string, criteria: object, status: string, validUntil: string}>} demands
 * @param {{now?: Date}} [options]
 */
export function buildDemandMap(demands, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const vigentes = (demands ?? []).filter(
    (demand) =>
      demand &&
      demand.status === "OPEN" &&
      Date.parse(demand.validUntil) > now.getTime(),
  );

  const porPresupuesto = new Map();
  const porTipo = new Map();
  let sinPresupuesto = 0;
  let conPermuta = 0;
  let sinUrgenciaDeclarada = 0;
  let listasEnSieteDias = 0;

  for (const demand of vigentes) {
    const criteria = demand.criteria ?? {};
    const currency = String(criteria.currency ?? "ARS").toUpperCase();
    const maxPriceCents = Number(criteria.maxPriceCents);

    if (Number.isFinite(maxPriceCents) && maxPriceCents > 0) {
      const major = Math.round(maxPriceCents / 100);
      const { from, to } = rangeFor(currency, major);
      increment(porPresupuesto, bucketKey(currency, from, to), {
        moneda: currency,
        desde: from,
        hasta: to,
        etiqueta: bucketLabel(currency, from, to),
      });
    } else {
      sinPresupuesto += 1;
    }

    const tipos = Array.isArray(criteria.types) ? criteria.types : [];
    if (tipos.length === 0) {
      increment(porTipo, "sin-declarar", { tipo: null, etiqueta: "sin tipo declarado" });
    } else {
      // Una persona que acepta dos tipos cuenta en los dos: el tablero
      // responde "cuántos aceptarían esto", no "cuántos quieren sólo esto".
      for (const tipo of new Set(tipos.map((value) => String(value).toLowerCase()))) {
        increment(porTipo, tipo, { tipo, etiqueta: tipo });
      }
    }

    if (criteria.tradeIn === true) conPermuta += 1;

    const urgencyDays = Number(criteria.urgencyDays);
    if (!Number.isFinite(urgencyDays)) sinUrgenciaDeclarada += 1;
    else if (urgencyDays <= READY_TO_BUY_DAYS) listasEnSieteDias += 1;
  }

  const ordenar = (map) =>
    Object.freeze(
      [...map.values()]
        .map((row) => Object.freeze(row))
        .sort((left, right) => right.personas - left.personas),
    );

  return Object.freeze({
    schemaVersion: DEMAND_MAP_SCHEMA_VERSION,
    generadoEn: now.toISOString(),
    totalDemandas: vigentes.length,
    vacio: vigentes.length === 0,
    porPresupuesto: ordenar(porPresupuesto),
    porTipo: ordenar(porTipo),
    conPermuta,
    listasEnSieteDias,
    // Lo que no se puede afirmar se declara, no se rellena.
    noDeclarado: Object.freeze({
      presupuesto: sinPresupuesto,
      urgencia: sinUrgenciaDeclarada,
    }),
  });
}
