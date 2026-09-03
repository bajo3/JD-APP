import assert from "node:assert/strict";
import test from "node:test";

import {
  AppraisalRangeError,
  estimateAppraisalRange,
  normalizeAppraisalRuleset,
} from "../lib/domain/appraisal-range.mjs";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function ruleset(overrides = {}) {
  return normalizeAppraisalRuleset({
    version: "TASACION-2026-09",
    currency: "ARS",
    referenceKmPerYear: 15_000,
    kmPenaltyBpsPer10k: 250,
    maxKmPenaltyBps: 3_000,
    references: [
      { make: "Volkswagen", model: "Suran", year: 2013, baseCents: 12_000_000_00 },
      { make: "Volkswagen", model: "Gol", year: 2012, baseCents: 9_000_000_00 },
    ],
    ...overrides,
  });
}

function suran(overrides = {}) {
  return {
    make: "Volkswagen",
    model: "Suran",
    year: 2013,
    mileageKm: 13 * 15_000,
    declaredCondition: "GOOD",
    hasLien: false,
    ...overrides,
  };
}

test("un tarifario sin referencias no se acepta", () => {
  assert.throws(() => normalizeAppraisalRuleset({ references: [] }), AppraisalRangeError);
  assert.throws(() => normalizeAppraisalRuleset({}), AppraisalRangeError);
  assert.throws(
    () => normalizeAppraisalRuleset({ references: [{ make: "VW", model: "Gol", year: 2012, baseCents: 0 }] }),
    AppraisalRangeError,
  );
});

test("con referencia cargada devuelve un rango, no un número solo", () => {
  const result = estimateAppraisalRange(ruleset(), suran(), { now: NOW });
  assert.equal(result.estimable, true);
  assert.ok(result.lowCents < result.baseCents);
  assert.ok(result.baseCents < result.highCents);
  assert.equal(result.currency, "ARS");
  assert.equal(result.certainty, "T0");
  assert.equal(result.requiresReview, true, "nunca cierra la tasación");
  assert.match(result.aviso, /sujeto a revisión física y documental/);
});

test("el rango se puede auditar: dice de dónde salió cada peso", () => {
  const result = estimateAppraisalRange(
    ruleset(),
    suran({ mileageKm: 250_000, declaredCondition: "FAIR" }),
    { now: NOW },
  );
  assert.equal(result.basis.rulesetVersion, "TASACION-2026-09");
  assert.equal(result.basis.referenciaCents, 12_000_000_00);
  const conceptos = result.basis.ajustes.map((row) => row.concepto);
  assert.deepEqual(conceptos, ["kilometraje", "estado declarado"]);
  assert.ok(result.basis.ajustes.every((row) => row.bps < 0));
  assert.match(result.basis.ajustes[0].detalle, /250\.000 km/);
});

test("sin referencia para esa unidad y ese año no se estima", () => {
  const result = estimateAppraisalRange(ruleset(), suran({ year: 2016 }), { now: NOW });
  assert.equal(result.estimable, false);
  assert.equal(result.reason, "NO_REFERENCE");
  assert.equal(result.requiresReview, true);
  assert.equal(result.lowCents, undefined, "no hay número que mostrar");
});

test("una unidad con prenda la mira una persona", () => {
  const result = estimateAppraisalRange(ruleset(), suran({ hasLien: true }), { now: NOW });
  assert.equal(result.estimable, false);
  assert.equal(result.reason, "LIEN_DECLARED");
  assert.match(result.mensaje, /documentación/);
});

test("un estado no previsto no se interpreta: se deriva a una persona", () => {
  const result = estimateAppraisalRange(ruleset(), suran({ declaredCondition: "IMPECABLE" }), {
    now: NOW,
  });
  assert.equal(result.estimable, false);
  assert.equal(result.reason, "UNKNOWN_CONDITION");
});

test("menos kilómetros de los esperados no suma valor", () => {
  const esperado = estimateAppraisalRange(ruleset(), suran(), { now: NOW });
  const pocos = estimateAppraisalRange(ruleset(), suran({ mileageKm: 40_000 }), { now: NOW });
  assert.equal(pocos.baseCents, esperado.baseCents, "un premio por km bajo habría que verlo");
  assert.equal(pocos.basis.ajustes.length, 0);
});

test("el castigo por kilometraje tiene tope", () => {
  const muchos = estimateAppraisalRange(ruleset(), suran({ mileageKm: 900_000 }), { now: NOW });
  const tope = Math.round((12_000_000_00 * (10_000 - 3_000)) / 10_000);
  assert.equal(muchos.basis.ajustes[0].bps, -3_000);
  assert.equal(muchos.baseCents, tope);
});

test("más evidencia angosta el rango en lugar de cambiar el valor", () => {
  const declarado = estimateAppraisalRange(ruleset(), suran(), { now: NOW, certainty: "T0" });
  const revisado = estimateAppraisalRange(ruleset(), suran(), { now: NOW, certainty: "T1" });
  assert.equal(declarado.baseCents, revisado.baseCents);
  assert.ok(
    revisado.highCents - revisado.lowCents < declarado.highCents - declarado.lowCents,
    "con la unidad vista, el rango se angosta",
  );
  assert.equal(revisado.requiresReview, true, "ni con T1 se cierra sola");
});

test("la marca y el modelo se buscan sin depender de mayúsculas", () => {
  const result = estimateAppraisalRange(
    ruleset(),
    suran({ make: "  volkswagen ", model: "SURAN" }),
    { now: NOW },
  );
  assert.equal(result.estimable, true);
});
