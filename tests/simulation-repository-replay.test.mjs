import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env = Object.freeze({});",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      const path = specifier === "@/db"
        ? resolve(projectRoot, "db/index.ts")
        : resolve(projectRoot, `${specifier.slice(2)}.ts`);
      return { url: pathToFileURL(path).href, shortCircuit: true };
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]s$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        source: stripTypeScriptTypes(source, { mode: "transform", sourceMap: false }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const {
  D1SimulationRepository,
  SimulationReplayConflict,
  canonicalSimulationInput,
} = await import("../lib/data/repositories.ts");

function simulationRow(overrides = {}) {
  return {
    id: "simulation-existing",
    publicCode: "JD-EXISTING",
    idempotencyKey: "simulation:replay:001",
    leadId: "lead-1",
    vehicleId: "vehicle-1",
    appraisalId: "appraisal-1",
    promotionId: null,
    status: "ACTIVE",
    classification: "REACHABLE",
    certaintyLevel: "T1",
    vehiclePriceCents: 2_000_000_000,
    effectivePriceCents: 2_000_000_000,
    appraisalAppliedCents: 500_000_000,
    tradeInBonusCents: 0,
    cashCents: 400_000_000,
    financePrincipalCents: 1_100_000_000,
    termMonths: 24,
    installmentCents: 60_000_000,
    totalCostCents: 1_440_000_000,
    currency: "ARS",
    engineVersion: "engine-1",
    ruleVersion: "rules-1",
    financePlanVersion: "PLAN-1",
    inputSnapshotJson: JSON.stringify({
      at: "2026-08-17T12:00:00.000Z",
      cash: { currency: "ARS", minorUnits: 400_000_000 },
      acceptedTerms: [12, 24],
      preferences: { bodyTypes: ["suv"] },
    }),
    resultSnapshotJson: "{}",
    disclaimerSnapshot: "Simulación preliminar.",
    expiresAt: "2026-08-18T12:00:00.000Z",
    createdAt: "2026-08-17T12:00:00.000Z",
    ...overrides,
  };
}

function fakeDatabase(existing) {
  let insertCalls = 0;
  return {
    db: {
      select() {
        return {
          from() {
            return {
              where() {
                return { limit: async () => existing ? [existing] : [] };
              },
            };
          },
        };
      },
      insert() {
        insertCalls += 1;
        return {
          values() {
            return { onConflictDoNothing: async () => undefined };
          },
        };
      },
    },
    writes: () => insertCalls,
  };
}

test("simulation repository finds and replays an identical idempotent operation before writing", async () => {
  const existing = simulationRow();
  const fake = fakeDatabase(existing);
  const repository = new D1SimulationRepository(fake.db);
  assert.strictEqual(
    await repository.findByIdempotencyKey("simulation:replay:001"),
    existing,
  );

  const replay = await repository.create({
    ...existing,
    id: "simulation-retry",
    publicCode: "JD-RETRY",
    inputSnapshotJson: JSON.stringify({
      preferences: { bodyTypes: ["suv"] },
      acceptedTerms: [12, 24],
      cash: { minorUnits: 400_000_000, currency: "ARS" },
      at: "2026-08-17T12:05:00.000Z",
    }),
  });

  assert.strictEqual(replay, existing);
  assert.equal(fake.writes(), 0);
});

test("the same idempotency key with a different selection fails OPERATION_CHANGED without writing", async () => {
  const existing = simulationRow();
  const fake = fakeDatabase(existing);
  const repository = new D1SimulationRepository(fake.db);

  await assert.rejects(
    () => repository.create({ ...existing, id: "retry", vehicleId: "vehicle-2" }),
    (error) =>
      error instanceof SimulationReplayConflict && error.code === "OPERATION_CHANGED",
  );
  assert.equal(fake.writes(), 0);
});

test("the same selection with different canonical input also fails without writing", async () => {
  const existing = simulationRow();
  const fake = fakeDatabase(existing);
  const repository = new D1SimulationRepository(fake.db);

  await assert.rejects(
    () => repository.create({
      ...existing,
      id: "retry-with-different-cash",
      inputSnapshotJson: JSON.stringify({
        at: "2026-08-17T12:05:00.000Z",
        cash: { currency: "ARS", minorUnits: 450_000_000 },
        acceptedTerms: [12, 24],
        preferences: { bodyTypes: ["suv"] },
      }),
    }),
    (error) =>
      error instanceof SimulationReplayConflict && error.code === "OPERATION_CHANGED",
  );
  assert.equal(fake.writes(), 0);
});

test("canonical comparison ignores only server evaluation time and preserves operation fields", () => {
  assert.deepEqual(
    canonicalSimulationInput({
      evaluatedAt: "2026-08-17T12:05:00.000Z",
      acceptedTerms: [12, 24],
      cash: { minorUnits: 400_000_000, currency: "ARS" },
    }),
    {
      acceptedTerms: [12, 24],
      cash: { currency: "ARS", minorUnits: 400_000_000 },
    },
  );
  assert.throws(
    () => canonicalSimulationInput("not-json"),
    /SIMULATION_INPUT_SNAPSHOT_INVALID/,
  );
});
