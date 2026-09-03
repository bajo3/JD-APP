import assert from "node:assert/strict";
import test from "node:test";

import { buildDemandMap, READY_TO_BUY_DAYS } from "../lib/analytics/demand-map.mjs";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const VIGENTE = "2026-10-03T12:00:00.000Z";
const VENCIDA = "2026-08-01T12:00:00.000Z";

function demand(id, criteria, overrides = {}) {
  return { id, criteria, status: "OPEN", validUntil: VIGENTE, ...overrides };
}

test("un tablero sin demandas se declara vacío en lugar de mostrar ceros", () => {
  const map = buildDemandMap([], { now: NOW });
  assert.equal(map.vacio, true);
  assert.equal(map.totalDemandas, 0);
  assert.deepEqual(map.porPresupuesto, []);
  assert.deepEqual(map.porTipo, []);
});

test("sólo cuentan las demandas abiertas y vigentes", () => {
  const map = buildDemandMap(
    [
      demand("a", { currency: "USD", maxPriceCents: 25_000_00, types: ["pickup"] }),
      demand("b", { currency: "USD", maxPriceCents: 25_000_00 }, { validUntil: VENCIDA }),
      demand("c", { currency: "USD", maxPriceCents: 25_000_00 }, { status: "FULFILLED" }),
    ],
    { now: NOW },
  );
  assert.equal(map.totalDemandas, 1);
});

test("los rangos de presupuesto agrupan gente comparable", () => {
  const map = buildDemandMap(
    [
      demand("a", { currency: "USD", maxPriceCents: 22_000_00, types: ["pickup"] }),
      demand("b", { currency: "USD", maxPriceCents: 28_000_00, types: ["pickup"] }),
      demand("c", { currency: "USD", maxPriceCents: 12_000_00, types: ["auto"] }),
    ],
    { now: NOW },
  );
  const pickupRange = map.porPresupuesto.find((row) => row.desde === 20_000);
  assert.equal(pickupRange.personas, 2);
  assert.equal(pickupRange.moneda, "USD");
  assert.match(pickupRange.etiqueta, /USD/);
  assert.equal(map.porPresupuesto.reduce((sum, row) => sum + row.personas, 0), 3);
});

test("un presupuesto no declarado se cuenta aparte, no se estima", () => {
  const map = buildDemandMap(
    [
      demand("a", { types: ["pickup"] }),
      demand("b", { currency: "USD", maxPriceCents: 25_000_00, types: ["pickup"] }),
    ],
    { now: NOW },
  );
  assert.equal(map.noDeclarado.presupuesto, 1);
  assert.equal(
    map.porPresupuesto.reduce((sum, row) => sum + row.personas, 0),
    1,
    "la demanda sin presupuesto no se reparte en ningún rango",
  );
});

test("quien acepta dos tipos cuenta en los dos", () => {
  const map = buildDemandMap(
    [demand("a", { maxPriceCents: 10_000_000_00, types: ["suv", "pickup"] })],
    { now: NOW },
  );
  assert.equal(map.totalDemandas, 1);
  assert.deepEqual(
    map.porTipo.map((row) => row.tipo).sort(),
    ["pickup", "suv"],
    "el tablero responde cuántos aceptarían esto",
  );
});

test("las demandas sin tipo declarado no desaparecen del tablero", () => {
  const map = buildDemandMap([demand("a", { maxPriceCents: 10_000_000_00 })], { now: NOW });
  const [row] = map.porTipo;
  assert.equal(row.tipo, null);
  assert.equal(row.etiqueta, "sin tipo declarado");
  assert.equal(row.personas, 1);
});

test("se cuentan permutas y compras inminentes, y la urgencia no declarada se dice", () => {
  const map = buildDemandMap(
    [
      demand("a", { maxPriceCents: 1_000_000_00, tradeIn: true, urgencyDays: READY_TO_BUY_DAYS }),
      demand("b", { maxPriceCents: 1_000_000_00, tradeIn: true, urgencyDays: 30 }),
      demand("c", { maxPriceCents: 1_000_000_00 }),
    ],
    { now: NOW },
  );
  assert.equal(map.conPermuta, 2);
  assert.equal(map.listasEnSieteDias, 1);
  assert.equal(map.noDeclarado.urgencia, 1, "sin urgencia declarada no se asume que no tiene apuro");
});

test("los rangos son tramos fijos, no cuantiles de la muestra", () => {
  const pocas = buildDemandMap(
    [demand("a", { currency: "USD", maxPriceCents: 22_000_00 })],
    { now: NOW },
  );
  const muchas = buildDemandMap(
    [
      demand("a", { currency: "USD", maxPriceCents: 22_000_00 }),
      demand("b", { currency: "USD", maxPriceCents: 6_000_00 }),
      demand("c", { currency: "USD", maxPriceCents: 45_000_00 }),
    ],
    { now: NOW },
  );
  const rango = (map) => map.porPresupuesto.find((row) => row.desde === 20_000);
  assert.deepEqual(
    [rango(pocas).desde, rango(pocas).hasta],
    [rango(muchas).desde, rango(muchas).hasta],
    "dos lecturas del tablero son comparables entre sí",
  );
});
