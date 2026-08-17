import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  createSimulationSnapshot,
  searchAffordability,
} from "../lib/application/index.mjs";
import { ApiError } from "../lib/server/api.ts";
import {
  financeRulesetVersion,
  requireCurrentFinancePlans,
} from "../lib/server/finance-policy.ts";
import {
  buildDemoSeedSql,
  resolveSeedRuntime,
  runDemoSeed,
} from "../scripts/seed-demo-d1.mjs";

const clock = new Date("2026-08-16T15:00:00.000Z");

function migration(path) {
  return readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", "");
}

test("incremental migration and demo D1 seed are valid and idempotent", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(migration("drizzle/0000_chemical_tiger_shark.sql"));
  db.exec(migration("drizzle/0001_worried_valkyrie.sql"));
  const dataMigration = migration("drizzle/0002_seed_demo_publication.sql");
  db.exec(dataMigration);
  db.exec(dataMigration);
  const seed = buildDemoSeedSql(clock);
  db.exec(seed);
  db.exec(seed);

  assert.equal(db.prepare("SELECT count(*) AS count FROM vehicle WHERE source = 'DEMO_SEED'").get().count, 3);
  assert.equal(db.prepare("SELECT count(*) AS count FROM promotion WHERE id = 'promo-demo-dia'").get().count, 1);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM finance_plan_version WHERE id = 'finance-plan-demo-preview' AND is_demo = 1").get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM finance_plan_tier WHERE finance_plan_version_id = 'finance-plan-demo-preview'").get().count,
    3,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  const plan = db
    .prepare(
      "SELECT name, provider, disclaimer, valid_from, valid_until FROM finance_plan_version WHERE id = 'finance-plan-demo-preview'",
    )
    .get();
  assert.match(plan.name, /^DEMO/);
  assert.equal(plan.provider, "DEMO_NO_COMERCIAL");
  assert.match(plan.disclaimer, /No constituye una oferta/i);
  assert.ok(Date.parse(plan.valid_from) <= clock.getTime());
  assert.ok(Date.parse(plan.valid_until) > clock.getTime());
});

test("local seed targets the built DB binding and preview persistence", () => {
  const runtime = resolveSeedRuntime([], process.cwd());
  assert.equal(runtime.database, "DB");
  assert.match(runtime.configPath.replaceAll("\\", "/"), /dist\/server\/wrangler\.json$/);
  assert.match(runtime.persistPath.replaceAll("\\", "/"), /\.wrangler\/state$/);
  assert.equal(runtime.remote, false);
});

test("remote seed requires an explicit demo confirmation", () => {
  assert.throws(
    () => runDemoSeed(["--remote", "--dry-run"]),
    /requires the explicit --confirm-demo flag/,
  );
});

test("production without a published finance plan keeps the stable 503", () => {
  assert.throws(
    () =>
      requireCurrentFinancePlans(
        [],
        () =>
          new ApiError(
            503,
            "FINANCE_RULES_UNAVAILABLE",
            "El tarifario financiero todavía no está publicado.",
          ),
      ),
    (error) =>
      error instanceof ApiError &&
      error.status === 503 &&
      error.code === "FINANCE_RULES_UNAVAILABLE",
  );
});

test("D1-shaped published plan drives affordability and carries the DEMO disclaimer", async () => {
  const demoDisclaimer =
    "TARIFARIO DEMO: valores ficticios. No constituye una condición comercial real.";
  const plan = {
    id: "finance-plan-demo-preview",
    version: "DEMO-PREVIEW-V1",
    name: "DEMO — Plan ilustrativo",
    enabled: true,
    validFrom: "2026-08-16T14:00:00.000Z",
    validUntil: "2026-09-16T14:00:00.000Z",
    allowedTerms: [12, 18, 24],
    minAmountCents: 300000000,
    maxAmountCents: 2200000000,
    maxFinanceRatioBps: 7000,
    minimumDownPaymentRatioBps: 2500,
    allowedVehicleTypes: ["car", "suv", "pickup"],
    maxVehicleAgeYears: 10,
    requiresPromotionId: null,
    comfortablePaymentMarginBps: 1000,
    isDemo: true,
    disclaimer: demoDisclaimer,
    pricing: { kind: "french", monthlyRateBps: 250 },
  };
  const plans = requireCurrentFinancePlans([plan], () => new Error("not expected"));
  const result = await searchAffordability(
    {
      evaluatedAt: clock.toISOString(),
      cashCents: 500000000,
      accreditedDepositCents: 0,
      maxMonthlyPaymentCents: 150000000,
      acceptedTerms: [12, 18, 24],
    },
    {
      records: {
        vehicles: [
          {
            id: "veh-cronos-2023",
            slug: "fiat-cronos-drive-2023",
            make: "Fiat",
            model: "Cronos",
            trim: "Drive 1.3",
            year: 2023,
            bodyType: "Sedán",
            status: "AVAILABLE",
            priceCents: 2490000000,
            currency: "ARS",
            lastSyncedAt: "2026-08-16T14:30:00.000Z",
            publishedAt: "2026-08-16T14:00:00.000Z",
          },
        ],
        plans,
        promotions: [],
        rulesetVersion: financeRulesetVersion(plans),
        comfortablePaymentMarginBps: 1000,
      },
      clock: () => clock,
    },
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.rulesetVersion, "d1:DEMO-PREVIEW-V1");
  assert.equal(result.demo, true);
  assert.ok(result.disclaimers.includes(demoDisclaimer));

  const snapshot = await createSimulationSnapshot(
    {
      evaluatedAt: clock.toISOString(),
      vehicleId: "veh-cronos-2023",
      simulationCode: "JD-DEMO-D1",
      cashCents: 500000000,
      accreditedDepositCents: 0,
      maxMonthlyPaymentCents: 150000000,
      acceptedTerms: [12, 18, 24],
    },
    {
      records: {
        vehicles: [
          {
            id: "veh-cronos-2023",
            slug: "fiat-cronos-drive-2023",
            make: "Fiat",
            model: "Cronos",
            trim: "Drive 1.3",
            year: 2023,
            bodyType: "Sedán",
            status: "AVAILABLE",
            priceCents: 2490000000,
            currency: "ARS",
            lastSyncedAt: "2026-08-16T14:30:00.000Z",
            publishedAt: "2026-08-16T14:00:00.000Z",
          },
        ],
        plans,
        promotions: [],
        rulesetVersion: financeRulesetVersion(plans),
        comfortablePaymentMarginBps: 1000,
      },
      clock: () => clock,
    },
  );
  assert.equal(snapshot.demo, true);
  assert.ok(snapshot.disclaimers.includes(demoDisclaimer));
});
