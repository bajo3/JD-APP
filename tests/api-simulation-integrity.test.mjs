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
      const relative = specifier.slice(2);
      if (relative === "db") {
        return {
          url: pathToFileURL(resolve(projectRoot, "db/index.ts")).href,
          shortCircuit: true,
        };
      }
      const extension = relative.endsWith(".mjs") ? "" : ".ts";
      return {
        url: pathToFileURL(resolve(projectRoot, `${relative}${extension}`)).href,
        shortCircuit: true,
      };
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
  createFixtureApplicationRecords,
  createSimulationSnapshot,
  searchAffordability,
} = await import("../lib/application/index.mjs");
const { moneyFromMajor } = await import("../lib/domain/index.mjs");
const { createSimulationResponse } = await import("../lib/server/simulation-api.ts");

const AT = "2026-08-16T15:00:00.000Z";
const searchRequest = Object.freeze({
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

function request(body, key = "simulation:integrity:001") {
  return new Request("http://localhost/api/v1/simulations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

function accessFor(vehicle) {
  let stored = null;
  let writes = 0;
  return {
    access: {
      source: "fixture",
      stock: {
        listAvailable: async () => [vehicle],
        findBySlug: async (slug) => slug === vehicle.slug ? vehicle : null,
      },
      businessProfile: { get: async () => null },
      leads: {},
      appraisals: {},
      promotions: { findCurrent: async () => null },
      simulations: {
        findByPublicCode: async () => null,
        findByIdempotencyKey: async (key) =>
          stored?.idempotencyKey === key ? stored : null,
        async create(input) {
          writes += 1;
          stored = { createdAt: AT, ...input };
          return stored;
        },
      },
      recordConsent: async () => undefined,
      recordLeadEvent: async () => true,
    },
    writes: () => writes,
    stored: () => stored,
  };
}

async function setup(records = createFixtureApplicationRecords()) {
  const dependencies = { records, clock: () => new Date(AT) };
  const search = await searchAffordability(searchRequest, dependencies);
  const selected = search.results.find(({ status }) => status !== "NOT_ELIGIBLE");
  assert.ok(selected, "fixture must expose an eligible selection");
  const vehicle = {
    ...selected.vehicle,
    currency: "ARS",
    priceValidUntil: null,
  };
  const store = accessFor(vehicle);
  return {
    ...store,
    dependencies,
    command: {
      vehicleId: selected.vehicle.id,
      vehicleSlug: selected.vehicle.slug,
      selectionVersion: selected.selectionVersion,
      simulationInput: search.simulationInput,
    },
  };
}

function runtime(setup, createSnapshot = createSimulationSnapshot) {
  return {
    access: setup.access,
    dependencies: setup.dependencies,
    now: new Date(AT),
    idGenerator: () => "simulation-api-1",
    codeGenerator: () => "JD-API-1",
    createSnapshot,
  };
}

test("simulation API preserves trade-in and replays an identical compact command", async () => {
  const fixture = await setup();
  let confirmations = 0;
  const confirmingSnapshot = async (...args) => {
    confirmations += 1;
    return createSimulationSnapshot(...args);
  };

  const created = await createSimulationResponse(
    request(fixture.command),
    runtime(fixture, confirmingSnapshot),
  );
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(fixture.writes(), 1);
  assert.equal(confirmations, 1);
  assert.equal(
    createdBody.data.input.selectionVersion,
    fixture.command.selectionVersion,
  );
  assert.deepEqual(
    createdBody.data.input.simulationInput.appraisal,
    fixture.command.simulationInput.appraisal,
  );
  assert.ok(createdBody.data.amounts.appraisalAppliedCents > 0);

  const replay = await createSimulationResponse(
    request(fixture.command),
    runtime(fixture, confirmingSnapshot),
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.equal(fixture.writes(), 1);
  assert.equal(confirmations, 1, "an exact replay must not recalculate");
});

test("same idempotency key with another selectionVersion returns 409 before a write", async () => {
  const fixture = await setup();
  await createSimulationResponse(request(fixture.command), runtime(fixture));
  const changed = {
    ...fixture.command,
    selectionVersion: "0".repeat(64),
  };
  const response = await createSimulationResponse(request(changed), runtime(fixture));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "OPERATION_CHANGED");
  assert.equal(fixture.writes(), 1);
});

test("stale commercial records return OPERATION_CHANGED and never persist", async () => {
  const original = createFixtureApplicationRecords();
  const fixture = await setup(original);
  const changedRecords = {
    ...original,
    vehicles: original.vehicles.map((vehicle) =>
      vehicle.id === fixture.command.vehicleId
        ? { ...vehicle, price: moneyFromMajor(28_000_000n), version: "price-v2" }
        : vehicle,
    ),
  };
  const response = await createSimulationResponse(request(fixture.command), {
    ...runtime(fixture),
    dependencies: { records: changedRecords, clock: () => new Date(AT) },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "OPERATION_CHANGED");
  assert.equal(fixture.writes(), 0);
});

test("simulation API rejects client-calculated breakdowns", async () => {
  const fixture = await setup();
  const response = await createSimulationResponse(
    request({ ...fixture.command, breakdown: { principalCents: 1 } }),
    runtime(fixture),
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  assert.equal(fixture.writes(), 0);
});
