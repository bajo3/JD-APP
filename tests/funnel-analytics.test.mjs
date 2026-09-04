import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FUNNEL_STEPS,
  UNMEASURED,
  buildConversionFunnel,
  conversionRate,
} from "../lib/analytics/funnel.mjs";

const WINDOW = Object.freeze({
  since: "2026-07-20T15:00:00.000Z",
  until: "2026-08-19T15:00:00.000Z",
});

const FULL = Object.freeze({
  simulations: 200,
  linkedLeads: 50,
  handoffs: 40,
  contacted: 25,
  won: 5,
});

test("una tasa sobre cero pasos previos es indefinida, no cero", () => {
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(7, 0), null);
  assert.equal(conversionRate(0, 10), 0);
  assert.equal(conversionRate(1, 3), 33.3);
  assert.equal(conversionRate(10, 10), 100);
});

test("el embudo compara cada paso con el anterior y con el origen", () => {
  const funnel = buildConversionFunnel(FULL, WINDOW);
  assert.deepEqual(
    funnel.steps.map((step) => step.value),
    [200, 50, 40, 25, 5],
  );
  assert.equal(funnel.steps[0].fromPrevious, null);
  assert.equal(funnel.steps[0].fromStart, null);
  assert.equal(funnel.steps[1].fromPrevious, 25);
  assert.equal(funnel.steps[1].fromStart, 25);
  assert.equal(funnel.steps[2].fromPrevious, 80);
  assert.equal(funnel.steps[2].fromStart, 20);
  assert.equal(funnel.steps[4].fromStart, 2.5);
  assert.equal(funnel.empty, false);
  assert.equal(funnel.since, WINDOW.since);
  assert.equal(funnel.until, WINDOW.until);
});

test("una ventana sin operaciones se declara vacía en lugar de mostrar ceros con tasas", () => {
  const funnel = buildConversionFunnel({}, WINDOW);
  assert.equal(funnel.empty, true);
  assert.deepEqual(
    funnel.steps.map((step) => step.value),
    [0, 0, 0, 0, 0],
  );
  for (const step of funnel.steps.slice(1)) {
    assert.equal(step.fromPrevious, null, step.key);
    assert.equal(step.fromStart, null, step.key);
  }
});

test("el embudo rechaza entradas que no son conteos reales", () => {
  assert.throws(() => buildConversionFunnel({ simulations: -1 }, WINDOW), /entero no negativo/);
  assert.throws(() => buildConversionFunnel({ simulations: 1.5 }, WINDOW), /entero no negativo/);
  assert.throws(() => buildConversionFunnel({ handoffs: "3" }, WINDOW), /entero no negativo/);
});

test("cada paso declara de qué registro sale y el resultado es inmutable", () => {
  const funnel = buildConversionFunnel(FULL, WINDOW);
  assert.equal(funnel.steps.length, FUNNEL_STEPS.length);
  for (const step of funnel.steps) {
    assert.ok(step.source.length > 10, step.key);
    assert.throws(() => {
      step.value = 999;
    }, TypeError);
  }
  assert.ok(Object.isFrozen(funnel));
  assert.ok(UNMEASURED.includes("Aperturas reales de WhatsApp"));
});

test("las consultas del embudo sólo leen tablas persistidas y respetan la ventana", async () => {
  const source = await readFile(new URL("../lib/server/funnel-data.ts", import.meta.url), "utf8");
  assert.match(source, /gte\(simulations\.createdAt, sinceIso\)/);
  assert.match(source, /lt\(simulations\.createdAt, untilIso\)/);
  assert.match(source, /eq\(leadEvents\.type, "WHATSAPP_HANDOFF_CREATED"\)/);
  assert.match(source, /count\(distinct \$\{leadInterests\.leadId\}\)/);
  // Nothing here may invent activity: no random, no sampling, no defaults
  // that fabricate a number when a query returns nothing.
  assert.doesNotMatch(source, /Math\.random|estimate|sample/i);
  assert.match(source, /breakdownQuery\(db, channelDimension\(\)/);
  assert.match(source, /breakdownQuery\(db, vehicleDimension\(\)/);
  assert.match(source, /breakdownQuery\(db, sellerDimension\(\)/);
});

test("el panel muestra el embudo y lo que todavía no mide", async () => {
  const page = await readFile(new URL("../app/panel/page.tsx", import.meta.url), "utf8");
  assert.match(page, /funnel\.steps\.map/);
  assert.match(page, /Sin medir todavía/);
  assert.match(page, /funnel\.empty/);
  assert.match(page, /Últimos 30 días/);
  assert.match(page, /Leads por canal, vehículo y responsable/);
  assert.match(page, /responsable refleja la asignación actual/);
});
