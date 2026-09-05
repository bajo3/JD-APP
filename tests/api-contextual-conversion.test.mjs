import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = Object.freeze({});", shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return {
        url: "data:text/javascript,export function notFound(){const e=new Error('NEXT_NOT_FOUND');e.digest='NEXT_NOT_FOUND';throw e}",
        shortCircuit: true,
      };
    }
    if (specifier === "next/headers") {
      return {
        url: "data:text/javascript,export async function headers(){return new Headers()}",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(resolve(
          projectRoot,
          specifier === "@/db"
            ? "db/index.ts"
            : specifier === "@/lib/admin"
              ? "lib/admin/index.ts"
              : relative.endsWith(".mjs") ? relative : `${relative}.ts`,
        )).href,
        shortCircuit: true,
      };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
          mode: "transform",
          sourceMap: false,
        }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { D1LeadConversionRepository } = await import("../lib/data/lead-conversion-repository.ts");
const { createLeadResponse } = await import("../lib/server/lead-conversion.ts");
const { createWhatsappHandoffResponse } = await import("../lib/server/whatsapp-handoff.ts");
const { getAdminLeadDetailData } = await import("../lib/server/admin-panel-data.ts");

const AT = new Date("2026-08-17T18:00:00.000Z");
const VEHICLE_ID = "vehicle-context-1";
const VEHICLE_SLUG = "toyota-corolla-contexto";
const SIMULATION_ID = "simulation-context-1";
const SIMULATION_CODE = "JD-CONTEXT1";

function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) {
        // node:sqlite no acepta un booleano nativo como bind: D1 real y el shim de
        // Postgres sí lo hacen, así que la base de pruebas en SQLite lo traduce acá.
        return statement(sql, values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
      },
      async first() { return database.prepare(sql).get(...bindings) ?? null; },
      async all() {
        return { results: database.prepare(sql).all(...bindings), success: true, meta: {} };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function databaseFixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const file of [
    "0000_chemical_tiger_shark.sql",
    "0001_worried_valkyrie.sql",
    "0002_seed_demo_publication.sql",
    "0003_confirm_jda_whatsapp.sql",
    "0004_furry_ultimatum.sql",
    "0005_lucky_exiles.sql",
    "0006_nostalgic_scarlet_spider.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, "drizzle-sqlite-archive", file), "utf8")
      .replaceAll("--> statement-breakpoint", ""));
  }
  database.prepare(
    `INSERT INTO vehicle
     (id, slug, make, model, trim, year, mileage_km, price_cents, currency,
      body_type, fuel_type, transmission, color, status, source, version,
      created_at, updated_at)
     VALUES (?, ?, 'Toyota', 'Corolla', 'XEI', 2022, 40000, 2490000000, 'ARS',
             'sedan', 'Nafta', 'Automática', 'Gris', 'AVAILABLE', 'test', 1, ?, ?)`,
  ).run(VEHICLE_ID, VEHICLE_SLUG, AT.toISOString(), AT.toISOString());
  database.prepare(
    `INSERT INTO simulation
     (id, public_code, idempotency_key, lead_id, vehicle_id, promotion_id, status,
      classification, certainty_level, vehicle_price_cents, effective_price_cents,
      appraisal_applied_cents, trade_in_bonus_cents, cash_cents,
      finance_principal_cents, term_months, installment_cents, total_cost_cents,
      currency, engine_version, rule_version, finance_plan_version,
      input_snapshot_json, result_snapshot_json, disclaimer_snapshot, expires_at,
      created_at)
     VALUES (?, ?, 'simulation-context-key', NULL, ?, 'promo-demo-dia', 'ACTIVE', 'REACHABLE', 'T0',
             2490000000, 2460000000, 1500000000, 0, 400000000, 560000000,
             18, 50000000, 900000000, 'ARS', 'engine-v1', 'rules-v1', 'plan-v1',
             '{}', '{}', 'Simulación preliminar sujeta a verificación.', ?, ?)`,
  ).run(
    SIMULATION_ID,
    SIMULATION_CODE,
    VEHICLE_ID,
    new Date(AT.getTime() + 60 * 60 * 1000).toISOString(),
    AT.toISOString(),
  );
  return database;
}

function row(database, sql, ...bindings) {
  return database.prepare(sql).get(...bindings) ?? null;
}

function counts(database) {
  return {
    leads: row(database, "SELECT count(*) count FROM lead WHERE source = 'AFFORDABILITY_WEB'").count,
    consents: row(database, "SELECT count(*) count FROM consent WHERE purpose = 'CONTACT_REQUEST'").count,
    interests: row(database, "SELECT count(*) count FROM lead_interest WHERE simulation_id = ?", SIMULATION_ID).count,
    events: row(database, "SELECT count(*) count FROM lead_event WHERE type = 'WHATSAPP_HANDOFF_CREATED'").count,
  };
}

function runtime(database, { whatsapp = "+5492494587046" } = {}) {
  const repository = new D1LeadConversionRepository(sqliteD1(database));
  const vehicle = {
    id: VEHICLE_ID,
    slug: VEHICLE_SLUG,
    make: "Toyota",
    model: "Corolla",
    trim: "XEI",
    year: 2022,
    status: "AVAILABLE",
  };
  const simulation = () => {
    const value = row(database, "SELECT * FROM simulation WHERE id = ?", SIMULATION_ID);
    return value ? {
      id: value.id,
      publicCode: value.public_code,
      leadId: value.lead_id,
      vehicleId: value.vehicle_id,
      promotionId: value.promotion_id,
    } : null;
  };
  const access = {
    source: "d1",
    leadConversions: repository,
    stock: { async findBySlug(slug) { return slug === VEHICLE_SLUG ? vehicle : null; } },
    simulations: { async findByPublicCode(code) { return code === SIMULATION_CODE ? simulation() : null; } },
    leads: {
      async findById(id) {
        const value = row(database, "SELECT * FROM lead WHERE id = ?", id);
        return value ? { id: value.id, status: value.status } : null;
      },
      async create() { throw new Error("generic create not expected"); },
    },
    businessProfile: { async get() { return { whatsappE164: whatsapp }; } },
    async recordConsent() { throw new Error("separate consent write not expected"); },
    async recordLeadEvent() { throw new Error("generic event write not expected"); },
  };
  return { repository, access, now: AT, idGenerator: () => "lead-context-1" };
}

function leadRequest(body = {}, key = "lead-contextual-key-001") {
  return new Request("http://localhost/api/v1/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      name: "Martín González",
      phone: "2494587046",
      contactConsent: true,
      privacyPolicyVersion: "v1",
      source: "AFFORDABILITY_WEB",
      simulationCode: SIMULATION_CODE,
      vehicleSlug: VEHICLE_SLUG,
      ...body,
    }),
  });
}

test("migration adds strict lead command and unique simulation interest constraints", () => {
  const database = databaseFixture();
  assert.ok(database.prepare("PRAGMA table_info(lead)").all().some((column) => column.name === "create_request_hash"));
  const indexes = database.prepare("PRAGMA index_list(lead_interest)").all().map((item) => item.name);
  assert.ok(indexes.includes("uq_lead_interest_lead_kind_simulation"));
  assert.ok(indexes.includes("uq_lead_interest_simulation"));
  assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("contextual lead atomically persists lead, consent, simulation link and interest", async () => {
  const database = databaseFixture();
  const context = runtime(database);
  const response = await createLeadResponse(leadRequest(), context);
  assert.equal(response.status, 201);
  assert.deepEqual(counts(database), { leads: 1, consents: 1, interests: 1, events: 0 });
  assert.equal(row(database, "SELECT lead_id FROM simulation WHERE id = ?", SIMULATION_ID).lead_id, "lead-context-1");
  const lead = row(database, "SELECT create_request_hash FROM lead WHERE id = 'lead-context-1'");
  assert.match(lead.create_request_hash, /^[a-f0-9]{64}$/);
  const commercial = JSON.parse(row(database, "SELECT context_json FROM lead_interest WHERE simulation_id = ?", SIMULATION_ID).context_json);
  assert.equal(commercial.simulationCode, SIMULATION_CODE);
  assert.equal("phone" in commercial, false);
  assert.equal("name" in commercial, false);
  assert.equal(
    row(database, "SELECT promotion_id FROM lead_interest WHERE simulation_id = ?", SIMULATION_ID).promotion_id,
    "promo-demo-dia",
  );
});

test("exact lead replay returns one graph; changed command conflicts without writes", async () => {
  const database = databaseFixture();
  const context = runtime(database);
  assert.equal((await createLeadResponse(leadRequest(), context)).status, 201);
  const replay = await createLeadResponse(leadRequest(), context);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(counts(database), { leads: 1, consents: 1, interests: 1, events: 0 });

  context.access.stock.findBySlug = async () => null;
  const replayAfterStockChange = await createLeadResponse(leadRequest(), context);
  assert.equal(replayAfterStockChange.status, 200);
  assert.deepEqual(counts(database), { leads: 1, consents: 1, interests: 1, events: 0 });

  const conflict = await createLeadResponse(
    leadRequest({ phone: "2494999999" }),
    context,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(counts(database), { leads: 1, consents: 1, interests: 1, events: 0 });
});

test("vehicle mismatch and already-linked simulation create no partial lead or consent", async () => {
  const mismatchDatabase = databaseFixture();
  const mismatch = runtime(mismatchDatabase);
  const response = await createLeadResponse(
    leadRequest({ vehicleSlug: "otra-unidad" }),
    mismatch,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(counts(mismatchDatabase), { leads: 0, consents: 0, interests: 0, events: 0 });

  const linkedDatabase = databaseFixture();
  linkedDatabase.prepare(
    `INSERT INTO lead
     (id, name, phone_normalized, source, status, version)
     VALUES ('other-lead', 'Otro', '2494111111', 'TEST', 'NEW', 1)`,
  ).run();
  linkedDatabase.prepare("UPDATE simulation SET lead_id = 'other-lead' WHERE id = ?").run(SIMULATION_ID);
  const linked = runtime(linkedDatabase);
  const rejected = await createLeadResponse(leadRequest(), linked);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error.code, "CRM_SIMULATION_ALREADY_LINKED");
  assert.deepEqual(counts(linkedDatabase), { leads: 0, consents: 0, interests: 0, events: 0 });
});

function handoffRequest(body = {}, key = "handoff-contextual-key-001") {
  return new Request("http://localhost/api/v1/whatsapp/handoffs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      leadId: "lead-context-1",
      simulationCode: SIMULATION_CODE,
      vehicleSlug: VEHICLE_SLUG,
      source: "AFFORDABILITY_WEB",
      ...body,
    }),
  });
}

test("contextual handoff requires the persisted exact link and replays one event", async () => {
  const database = databaseFixture();
  const context = runtime(database);
  await createLeadResponse(leadRequest(), context);
  const created = await createWhatsappHandoffResponse(handoffRequest(), context);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.simulationCode, SIMULATION_CODE);
  assert.equal(counts(database).events, 1);
  const replay = await createWhatsappHandoffResponse(handoffRequest(), context);
  assert.equal(replay.status, 200);
  assert.equal(counts(database).events, 1);

  const conflict = await createWhatsappHandoffResponse(
    handoffRequest({ source: "OTHER_SOURCE" }),
    context,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(counts(database).events, 1);
});

test("missing WhatsApp never removes the already persisted CRM context", async () => {
  const database = databaseFixture();
  const writable = runtime(database, { whatsapp: null });
  await createLeadResponse(leadRequest(), writable);
  const response = await createWhatsappHandoffResponse(handoffRequest(), writable);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "WHATSAPP_NOT_CONFIGURED");
  assert.deepEqual(counts(database), { leads: 1, consents: 1, interests: 1, events: 0 });
  assert.equal(row(database, "SELECT lead_id FROM simulation WHERE id = ?", SIMULATION_ID).lead_id, "lead-context-1");
});

test("handoff with an unlinked simulation is rejected before WhatsApp or event writes", async () => {
  const database = databaseFixture();
  const context = runtime(database);
  database.prepare(
    `INSERT INTO lead
     (id, name, phone_normalized, source, status, version)
     VALUES ('lead-context-1', 'Martín', '2494587046', 'TEST', 'NEW', 1)`,
  ).run();
  const response = await createWhatsappHandoffResponse(handoffRequest(), context);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CRM_CONTEXT_NOT_LINKED");
  assert.equal(counts(database).events, 0);
});

test("protected admin detail uses persisted snapshot and removes internal hashes", async () => {
  let authorized = 0;
  let reads = 0;
  const repository = {
    async findById(id) {
      reads += 1;
      assert.equal(id, "lead-context-1");
      return {
        lead: {
          id,
          name: "Martín González",
          phoneNormalized: "+5492494587046",
          source: "AFFORDABILITY_WEB",
          status: "NEW",
          createdAt: AT.toISOString(),
          updatedAt: AT.toISOString(),
        },
        simulation: {
          id: SIMULATION_ID,
          publicCode: SIMULATION_CODE,
          leadId: id,
          vehicleId: VEHICLE_ID,
          promotionId: null,
          status: "ACTIVE",
          classification: "REACHABLE",
          certaintyLevel: "T0",
          currency: "ARS",
          vehiclePriceCents: 2_490_000_000,
          effectivePriceCents: 2_460_000_000,
          appraisalAppliedCents: 1_500_000_000,
          tradeInBonusCents: 0,
          cashCents: 400_000_000,
          financePrincipalCents: 560_000_000,
          installmentCents: 50_000_000,
          totalCostCents: 900_000_000,
          termMonths: 18,
          createdAt: AT.toISOString(),
          expiresAt: new Date(AT.getTime() + 60_000).toISOString(),
          disclaimerSnapshot: "Simulación preliminar sujeta a verificación.",
        },
        vehicle: {
          id: VEHICLE_ID,
          slug: VEHICLE_SLUG,
          make: "Toyota",
          model: "Corolla",
          trim: "XEI",
          year: 2022,
        },
        events: [{
          id: "event-1",
          type: "WHATSAPP_HANDOFF_CREATED",
          actorType: "CUSTOMER",
          occurredAt: AT.toISOString(),
          metadataJson: JSON.stringify({
            handoffCode: "JD-ABC123",
            simulationId: SIMULATION_ID,
            requestHash: "secret-hash",
            idempotencyKey: "secret-key",
          }),
        }],
      };
    },
  };
  const result = await getAdminLeadDetailData("lead-context-1", {
    repository,
    now: AT,
    async authorize(returnTo) {
      authorized += 1;
      assert.equal(returnTo, "/panel/leads/lead-context-1");
    },
  });
  assert.equal(authorized, 1);
  assert.equal(reads, 1);
  assert.equal(result.lead.operation.simulationCode, SIMULATION_CODE);
  assert.equal(result.lead.operation.amounts.financePrincipalCents, 560_000_000);
  assert.equal(result.lead.events[0].metadata.handoffCode, "JD-ABC123");
  assert.equal("requestHash" in result.lead.events[0].metadata, false);
  assert.equal("idempotencyKey" in result.lead.events[0].metadata, false);
});

test("admin detail authorization fails closed before reading persisted PII", async () => {
  let reads = 0;
  await assert.rejects(
    () => getAdminLeadDetailData("lead-context-1", {
      repository: { async findById() { reads += 1; return null; } },
      async authorize() { throw new Error("ADMIN_AUTH_REQUIRED"); },
    }),
    /ADMIN_AUTH_REQUIRED/,
  );
  assert.equal(reads, 0);
});
