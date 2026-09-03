import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMAND_WEIGHTS,
  DemandContractError,
  FULL_MATCH_BPS,
  matchVehicleToDemand,
  normalizeDemandCriteria,
  rankDemandsForVehicle,
} from "../lib/domain/demand-matching.mjs";

const NOW = new Date("2026-09-03T12:00:00.000Z");

/** La demanda del ejemplo: Amarok desde 2015, hasta USD 25.000, entrega un Gol. */
function amarokCriteria(overrides = {}) {
  return normalizeDemandCriteria({
    makes: ["Volkswagen"],
    models: ["Amarok"],
    minYear: 2015,
    maxPriceCents: 25_000_00,
    currency: "USD",
    maxMileageKm: 150_000,
    tradeIn: true,
    urgencyDays: 30,
    ...overrides,
  });
}

function amarok(overrides = {}) {
  return {
    make: "Volkswagen",
    model: "Amarok",
    year: 2018,
    priceCents: 23_000_00,
    currency: "USD",
    mileageKm: 120_000,
    ...overrides,
  };
}

test("una demanda necesita algún criterio real", () => {
  assert.throws(() => normalizeDemandCriteria({}), DemandContractError);
  assert.throws(() => normalizeDemandCriteria({ minYear: 2015 }), DemandContractError);
  assert.throws(() => normalizeDemandCriteria({ makes: "Ford" }), DemandContractError);
  assert.ok(normalizeDemandCriteria({ maxPriceCents: 1 }));
});

test("la unidad que cumple todo lo declarado coincide al cien por ciento", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok());
  assert.equal(result.eligible, true);
  assert.equal(result.scoreBps, FULL_MATCH_BPS);
  assert.deepEqual(result.exclusions, []);
  assert.equal(result.breakdown.length, 5);
  assert.ok(result.breakdown.every((row) => row.cumple === true));
});

test("el porcentaje siempre viene con el detalle de qué criterio falló", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ make: "Ford", model: "Ranger" }));
  assert.equal(result.eligible, true, "no cumple marca ni modelo, pero se puede ofrecer");
  const fallidos = result.breakdown.filter((row) => row.cumple === false).map((row) => row.criterio);
  assert.deepEqual(fallidos.sort(), ["marca", "modelo"]);
  const esperado = Math.round(
    ((DEMAND_WEIGHTS.price + DEMAND_WEIGHTS.year + DEMAND_WEIGHTS.mileage) /
      (DEMAND_WEIGHTS.price + DEMAND_WEIGHTS.year + DEMAND_WEIGHTS.mileage + DEMAND_WEIGHTS.make + DEMAND_WEIGHTS.model)) *
      FULL_MATCH_BPS,
  );
  assert.equal(result.scoreBps, esperado);
});

test("lo que la persona no puede pagar no es una coincidencia peor: no es coincidencia", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ priceCents: 31_000_00 }));
  assert.equal(result.eligible, false);
  assert.equal(result.scoreBps, 0, "una unidad excluida no lleva porcentaje");
  assert.deepEqual(result.exclusions, ["ABOVE_BUDGET"]);
});

test("una unidad más vieja que el mínimo queda excluida", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ year: 2012 }));
  assert.equal(result.eligible, false);
  assert.deepEqual(result.exclusions, ["BELOW_MIN_YEAR"]);
});

test("no se convierte moneda: se declara la diferencia y se excluye", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ currency: "ARS" }));
  assert.equal(result.eligible, false);
  assert.deepEqual(result.exclusions, ["CURRENCY_MISMATCH"]);
});

test("un precio desconocido no se asume dentro del presupuesto", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ priceCents: null }));
  assert.equal(result.eligible, false);
  assert.deepEqual(result.exclusions, ["PRICE_UNKNOWN"]);
});

test("el kilometraje descuenta pero no excluye", () => {
  const result = matchVehicleToDemand(amarokCriteria(), amarok({ mileageKm: 260_000 }));
  assert.equal(result.eligible, true);
  assert.ok(result.scoreBps < FULL_MATCH_BPS);
  const km = result.breakdown.find((row) => row.criterio === "kilometraje");
  assert.equal(km.cumple, false);
  assert.match(km.detalle, /260000 km supera/);
});

test("lo que el comprador no declaró no penaliza a la unidad", () => {
  const criteria = normalizeDemandCriteria({ makes: ["Volkswagen"], models: ["Amarok"] });
  const result = matchVehicleToDemand(criteria, amarok({ year: 2001, mileageKm: 400_000 }));
  assert.equal(result.eligible, true);
  assert.equal(result.scoreBps, FULL_MATCH_BPS);
  assert.equal(result.breakdown.length, 2, "sólo pesan marca y modelo");
});

test("la marca coincide sin importar acentos ni mayúsculas", () => {
  const criteria = normalizeDemandCriteria({ makes: ["Citroën"], maxPriceCents: 100_000 });
  const result = matchVehicleToDemand(criteria, {
    make: "CITROEN",
    model: "C3",
    year: 2020,
    priceCents: 90_000,
    currency: "ARS",
  });
  assert.equal(result.scoreBps, FULL_MATCH_BPS);
});

test("una unidad nueva muestra qué compradores podrían estar interesados, ordenados", () => {
  const demands = [
    {
      id: "d-alta",
      leadId: "lead-1",
      status: "OPEN",
      validUntil: "2026-10-01T00:00:00.000Z",
      criteria: amarokCriteria(),
    },
    {
      id: "d-parcial",
      leadId: "lead-2",
      status: "OPEN",
      validUntil: "2026-10-01T00:00:00.000Z",
      criteria: normalizeDemandCriteria({
        makes: ["Ford"],
        models: ["Amarok"],
        minYear: 2015,
        maxPriceCents: 25_000_00,
        currency: "USD",
      }),
    },
    {
      id: "d-vencida",
      leadId: "lead-3",
      status: "OPEN",
      validUntil: "2026-08-01T00:00:00.000Z",
      criteria: amarokCriteria(),
    },
    {
      id: "d-cerrada",
      leadId: "lead-4",
      status: "FULFILLED",
      validUntil: "2026-10-01T00:00:00.000Z",
      criteria: amarokCriteria(),
    },
  ];
  const ranked = rankDemandsForVehicle(demands, amarok(), { now: NOW, minScoreBps: 5_000 });
  assert.deepEqual(
    ranked.map((row) => row.demandId),
    ["d-alta", "d-parcial"],
    "ni vencidas ni cerradas",
  );
  assert.ok(ranked[0].scoreBps >= ranked[1].scoreBps);
  assert.equal(ranked[0].leadId, "lead-1");
  assert.ok(Array.isArray(ranked[0].breakdown));
});

test("las coincidencias flojas no llegan al vendedor", () => {
  const demands = [
    {
      id: "d-floja",
      leadId: "lead-1",
      status: "OPEN",
      validUntil: "2026-10-01T00:00:00.000Z",
      criteria: normalizeDemandCriteria({
        makes: ["Ford"],
        models: ["Ranger"],
        maxPriceCents: 25_000_00,
        currency: "USD",
      }),
    },
  ];
  assert.equal(rankDemandsForVehicle(demands, amarok(), { now: NOW }).length, 0);
  assert.equal(
    rankDemandsForVehicle(demands, amarok(), { now: NOW, minScoreBps: 1_000 }).length,
    1,
    "el umbral es explícito, no un capricho del ranking",
  );
});
