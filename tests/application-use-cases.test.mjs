import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationContractError,
  createFixtureApplicationRecords,
  createSimulationSnapshot,
  searchAffordability,
} from "../lib/application/index.mjs";

const request = Object.freeze({
  evaluatedAt: "2026-08-16T15:00:00.000Z",
  cashArs: "4000000",
  accreditedDepositArs: "0",
  maxMonthlyPaymentArs: "1250000",
  acceptedTerms: [12, 18, 24, 36],
  appraisal: Object.freeze({
    lowArs: "16500000",
    baseArs: "17500000",
    highArs: "18200000",
    certainty: "T1",
    validUntil: "2026-08-18T03:00:00.000Z",
  }),
  preferences: Object.freeze({ preferredBrands: ["Fiat", "Toyota"] }),
});

test("searchAffordability returns a stable JSON contract with explanations", async () => {
  const records = createFixtureApplicationRecords();
  const first = await searchAffordability(request, { records });
  const second = await searchAffordability(request, { records });

  assert.deepEqual(first, second);
  assert.equal(first.currency, "ARS");
  assert.equal(first.results.length, 4);
  assert.equal(first.results[0].vehicle.id, "veh-cronos-2024");
  assert.equal(first.results[0].statusLabel, "Alcanzable con margen");
  assert.ok(first.disclaimers.every((message) => typeof message === "string"));
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.equal(JSON.stringify(first).includes("BigInt"), false);

  const unavailable = first.results.find(
    ({ vehicle }) => vehicle.id === "veh-ranger-2021",
  );
  assert.deepEqual(unavailable.reasonDetails, [
    { code: "vehicle_unavailable", message: "La unidad ya no está disponible." },
  ]);
});

test("repositories are injected and database-shaped records are accepted", async () => {
  const fixture = createFixtureApplicationRecords();
  const repositories = {
    rulesetVersion: "repo-rules-1",
    stock: {
      async listAvailable() {
        return fixture.vehicles.map((vehicle) => ({
          ...vehicle,
          make: vehicle.brand,
          brand: undefined,
          priceCents: vehicle.price.minorUnits,
          price: undefined,
        }));
      },
    },
    plans: { async list() { return fixture.plans; } },
    promotions: { async list() { return fixture.promotions; } },
  };
  const result = await searchAffordability(request, { repositories });
  assert.equal(result.rulesetVersion, "repo-rules-1");
  assert.equal(result.results.length, 4);
});

test("createSimulationSnapshot freezes and optionally persists the exact JSON DTO", async () => {
  let persisted = null;
  const simulationRepository = {
    async save(snapshot) {
      persisted = snapshot;
    },
  };
  const snapshot = await createSimulationSnapshot(
    {
      ...request,
      vehicleId: "veh-cronos-2024",
      simulationCode: "JD-TEST01",
    },
    {
      records: createFixtureApplicationRecords(),
      simulationRepository,
    },
  );
  assert.strictEqual(persisted, snapshot);
  assert.equal(snapshot.simulationCode, "JD-TEST01");
  assert.equal(snapshot.engineVersion, "jda-domain-1.0.0");
  assert.equal(snapshot.evaluation.breakdown.planId, "plan-jd-flash-cero-12");
  assert.ok(snapshot.expiresAt);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.evaluation.breakdown));
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test("application failures expose stable contract codes", async () => {
  await assert.rejects(
    () =>
      createSimulationSnapshot(
        { ...request, vehicleId: "missing", simulationCode: "JD-4040" },
        { records: createFixtureApplicationRecords() },
      ),
    (error) =>
      error instanceof ApplicationContractError && error.code === "vehicle_not_found",
  );
  await assert.rejects(
    () => searchAffordability(request),
    (error) =>
      error instanceof ApplicationContractError && error.code === "missing_data_source",
  );
});
