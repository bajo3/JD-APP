import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateInventory,
  evaluateOperation,
  fixtureInput,
  fixtureRuleset,
  fixtureSnapshots,
  moneyFromMajor,
} from "../lib/domain/index.mjs";

const accessibleStatuses = new Set([
  "reachable_with_margin",
  "reachable_estimated",
  "close",
]);

test("golden operation is reproducible and returns an auditable breakdown", () => {
  const snapshot = fixtureSnapshots.find(
    ({ vehicle }) => vehicle.id === "veh-cronos-2024",
  );
  const first = evaluateOperation(fixtureInput, fixtureRuleset, snapshot);
  const second = evaluateOperation(fixtureInput, fixtureRuleset, snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.status, "reachable_with_margin");
  assert.equal(first.breakdown.planId, "plan-jd-flash-cero-12");
  assert.equal(first.breakdown.principal.minorUnits, 800_000_000);
  assert.equal(first.breakdown.installment.minorUnits, 66_666_667);
  assert.deepEqual(first.appliedPromotionIds, ["promo-cronos-tasa-cero"]);
  assert.equal(first.rulesetVersion, fixtureRuleset.version);
  assert.ok(first.validUntil);
});

test("unavailable stock and expired plans can never become reachable", () => {
  const unavailable = fixtureSnapshots.find(
    ({ vehicle }) => vehicle.id === "veh-ranger-2021",
  );
  const unavailableResult = evaluateOperation(
    {
      ...fixtureInput,
      cash: moneyFromMajor(100_000_000n),
    },
    fixtureRuleset,
    unavailable,
  );
  assert.equal(unavailableResult.status, "unreachable_today");
  assert.deepEqual(unavailableResult.reasons, ["vehicle_unavailable"]);

  const currentVehicle = fixtureSnapshots.find(
    ({ vehicle }) => vehicle.id === "veh-corolla-2022",
  );
  const expiredRules = {
    ...fixtureRuleset,
    plans: fixtureRuleset.plans.map((plan) => ({
      ...plan,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-02-01T00:00:00.000Z",
    })),
  };
  const result = evaluateOperation(fixtureInput, expiredRules, currentVehicle);
  assert.equal(result.status, "unreachable_today");
  assert.ok(result.reasons.includes("plan_not_current"));
});

test("more cash never reduces the reachable inventory under identical rules", () => {
  let previousCount = -1;
  for (const cash of [0n, 1_000_000n, 3_000_000n, 6_000_000n, 10_000_000n]) {
    const results = evaluateInventory(
      { ...fixtureInput, cash: moneyFromMajor(cash) },
      fixtureRuleset,
      fixtureSnapshots,
    );
    const count = results.filter(({ evaluation }) =>
      accessibleStatuses.has(evaluation.status),
    ).length;
    assert.ok(count >= previousCount, `${cash} ARS reduced reachability`);
    previousCount = count;
  }
});

test("available cash is not forced when reserving it keeps financing valid", () => {
  const snapshot = fixtureSnapshots.find(
    ({ vehicle }) => vehicle.id === "veh-cronos-2024",
  );
  const result = evaluateOperation(
    { ...fixtureInput, cash: moneyFromMajor(10_000_000n) },
    fixtureRuleset,
    snapshot,
  );
  assert.equal(result.breakdown.principal.minorUnits, 300_000_000);
  assert.equal(result.breakdown.cashAvailable.minorUnits, 1_000_000_000);
  assert.equal(result.breakdown.cashUsed.minorUnits, 900_000_000);
});

test("a higher appraisal never reduces reachability under identical rules", () => {
  let previousCount = -1;
  for (const increase of [0n, 1_000_000n, 3_000_000n, 6_000_000n]) {
    const appraisal = {
      ...fixtureInput.appraisal,
      low: fixtureInput.appraisal.low.add(moneyFromMajor(increase)),
      base: fixtureInput.appraisal.base.add(moneyFromMajor(increase)),
      high: fixtureInput.appraisal.high.add(moneyFromMajor(increase)),
    };
    const results = evaluateInventory(
      { ...fixtureInput, appraisal },
      fixtureRuleset,
      fixtureSnapshots,
    );
    const count = results.filter(({ evaluation }) =>
      accessibleStatuses.has(evaluation.status),
    ).length;
    assert.ok(count >= previousCount, `${increase} ARS reduced reachability`);
    previousCount = count;
  }
});

test("lowering the maximum cuota never increases reachable inventory", () => {
  let previousCount = Number.MAX_SAFE_INTEGER;
  for (const cuota of [2_000_000n, 1_500_000n, 1_000_000n, 700_000n, 400_000n]) {
    const results = evaluateInventory(
      { ...fixtureInput, maxMonthlyPayment: moneyFromMajor(cuota) },
      fixtureRuleset,
      fixtureSnapshots,
    );
    const count = results.filter(({ evaluation }) =>
      accessibleStatuses.has(evaluation.status),
    ).length;
    assert.ok(count <= previousCount, `${cuota} ARS increased reachability`);
    previousCount = count;
  }
});

test("inventory ranking is explainable and puts unavailable units last", () => {
  const results = evaluateInventory(
    fixtureInput,
    fixtureRuleset,
    fixtureSnapshots,
  );
  assert.equal(results.at(-1).snapshot.vehicle.id, "veh-ranger-2021");
  assert.ok(results.every(({ evaluation }) => evaluation.breakdown.operationCost));
  assert.ok(results.every(({ rankSignals }) => Number.isInteger(rankSignals.financeRatioBps)));
});
