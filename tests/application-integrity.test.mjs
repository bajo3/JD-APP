import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationContractError,
  canonicalSha256,
  confirmAffordabilitySelection,
  createFixtureApplicationRecords,
  createSimulationSnapshot,
  searchAffordability,
} from "../lib/application/index.mjs";
import { moneyFromMajor } from "../lib/domain/index.mjs";

const AT = "2026-08-16T15:00:00.000Z";
const request = Object.freeze({
  evaluatedAt: AT,
  cashCents: 400_000_000,
  accreditedDepositCents: 0,
  maxMonthlyPaymentCents: 125_000_000,
  acceptedTerms: [12, 18, 24, 36],
  appraisal: Object.freeze({
    lowCents: 1_650_000_000,
    baseCents: 1_750_000_000,
    highCents: 1_820_000_000,
    certainty: "T0",
    requiresReview: false,
    validUntil: "2026-08-18T03:00:00.000Z",
  }),
  preferences: Object.freeze({ preferredBrands: ["Fiat"] }),
});

function dependencies(records, save) {
  return {
    records,
    clock: () => new Date(AT),
    ...(save ? { simulationRepository: { save } } : {}),
  };
}

function confirmationRequest(search, result, overrides = {}) {
  return {
    vehicleId: result.vehicle.id,
    vehicleSlug: result.vehicle.slug,
    selectionVersion: result.selectionVersion,
    simulationInput: search.simulationInput,
    ...overrides,
  };
}

function changedRecords(change) {
  const fixture = createFixtureApplicationRecords();
  return {
    ...fixture,
    vehicles: fixture.vehicles.map((vehicle) => ({ ...vehicle })),
    plans: fixture.plans.map((plan) => ({ ...plan, pricing: { ...plan.pricing } })),
    promotions: fixture.promotions.map((promotion) => ({
      ...promotion,
      benefit: { ...promotion.benefit },
    })),
    ...change(fixture),
  };
}

async function assertChangedWithoutWrite(records, mutateRequest = (value) => value) {
  const originalRecords = createFixtureApplicationRecords();
  const search = await searchAffordability(request, dependencies(originalRecords));
  const selected = search.results[0];
  let writes = 0;
  const command = mutateRequest(confirmationRequest(search, selected));
  await assert.rejects(
    () => createSimulationSnapshot(
      { ...command, simulationCode: "JD-INTEGRITY" },
      dependencies(records, async () => { writes += 1; }),
    ),
    (error) =>
      error instanceof ApplicationContractError &&
      error.code === "operation_changed",
  );
  assert.equal(writes, 0);
}

test("search emits an immutable, JSON-safe and PII-free selection receipt", async () => {
  const first = await searchAffordability(request, dependencies(createFixtureApplicationRecords()));
  const second = await searchAffordability(request, dependencies(createFixtureApplicationRecords()));

  assert.deepEqual(first, second);
  assert.deepEqual(first.simulationInput.appraisal, {
    lowCents: 1_650_000_000,
    baseCents: 1_750_000_000,
    highCents: 1_820_000_000,
    certainty: "T0",
    requiresReview: false,
    validUntil: "2026-08-18T03:00:00.000Z",
  });
  assert.match(first.results[0].selectionVersion, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(first.simulationInput));
  assert.ok(Object.isFrozen(first.results[0]));
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /"(?:name|phone|email|leadId)"/i);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("canonical SHA-256 is stable across object key order", async () => {
  const left = await canonicalSha256({ z: 3, nested: { b: 2, a: 1 }, list: [3, 2, 1] });
  const right = await canonicalSha256({ list: [3, 2, 1], nested: { a: 1, b: 2 }, z: 3 });
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("confirmation preserves the exact trade-in and saves only the recalculated snapshot", async () => {
  const records = createFixtureApplicationRecords();
  const search = await searchAffordability(request, dependencies(records));
  const selected = search.results[0];
  let persisted = null;
  const snapshot = await createSimulationSnapshot(
    {
      ...confirmationRequest(search, selected),
      simulationCode: "JD-CONFIRMED",
    },
    dependencies(records, async (value) => { persisted = value; }),
  );

  assert.strictEqual(persisted, snapshot);
  assert.equal(snapshot.selectionVersion, selected.selectionVersion);
  assert.equal(snapshot.request.appraisal.lowCents, request.appraisal.lowCents);
  assert.equal(
    snapshot.evaluation.breakdown.appraisalApplied.minorUnits,
    selected.evaluation.breakdown.appraisalApplied.minorUnits,
  );
  assert.equal(
    snapshot.evaluation.breakdown.principal.minorUnits,
    selected.evaluation.breakdown.principal.minorUnits,
  );
  assert.equal(
    snapshot.evaluation.breakdown.installment.minorUnits,
    selected.evaluation.breakdown.installment.minorUnits,
  );
});

test("a trade-in used by search cannot disappear during confirmation", async () => {
  await assertChangedWithoutWrite(
    createFixtureApplicationRecords(),
    (command) => ({
      ...command,
      simulationInput: { ...command.simulationInput, appraisal: null },
    }),
  );
});

test("price changes invalidate the selection before persistence", async () => {
  const records = changedRecords((fixture) => ({
    vehicles: fixture.vehicles.map((vehicle, index) =>
      index === 0
        ? { ...vehicle, price: moneyFromMajor(28_000_000n), version: "price-v2" }
        : { ...vehicle },
    ),
  }));
  await assertChangedWithoutWrite(records);
});

test("finance plan changes invalidate the selection even if rulesetVersion is reused", async () => {
  const records = changedRecords((fixture) => ({
    plans: fixture.plans.map((plan) =>
      plan.id === "plan-jd-flash-cero-12"
        ? {
            ...plan,
            version: "2026-08-flash-2",
            pricing: { kind: "french", monthlyRateBps: 100 },
          }
        : { ...plan, pricing: { ...plan.pricing } },
    ),
  }));
  await assertChangedWithoutWrite(records);
});

test("promotion changes invalidate the selection before persistence", async () => {
  const records = changedRecords((fixture) => ({
    promotions: fixture.promotions.map((promotion) =>
      promotion.id === "promo-cronos-tasa-cero"
        ? { ...promotion, version: "2", state: "PAUSED", benefit: { ...promotion.benefit } }
        : { ...promotion, benefit: { ...promotion.benefit } },
    ),
  }));
  await assertChangedWithoutWrite(records);
});

test("confirmation always uses the server clock and ignores a client evaluatedAt", async () => {
  const records = createFixtureApplicationRecords();
  const search = await searchAffordability(request, dependencies(records));
  const selected = search.results[0];
  const command = confirmationRequest(search, selected, {
    simulationInput: {
      ...search.simulationInput,
      evaluatedAt: AT,
      at: AT,
    },
  });

  await assert.rejects(
    () => confirmAffordabilitySelection(command, {
      records,
      clock: () => new Date("2026-08-17T04:00:00.000Z"),
    }),
    (error) =>
      error instanceof ApplicationContractError &&
      error.code === "operation_changed",
  );
});

test("confirmation helper returns only current server recalculation", async () => {
  const records = createFixtureApplicationRecords();
  const search = await searchAffordability(request, dependencies(records));
  const selected = search.results[0];
  const confirmation = await confirmAffordabilitySelection(
    confirmationRequest(search, selected),
    dependencies(records),
  );

  assert.equal(confirmation.selectionVersion, selected.selectionVersion);
  assert.deepEqual(confirmation.result.evaluation, selected.evaluation);
  assert.ok(Object.isFrozen(confirmation));
  assert.doesNotThrow(() => JSON.stringify(confirmation));
});
