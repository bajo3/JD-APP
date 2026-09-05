// Prueba comercial de punta a punta (Hito 8).
//
// One customer journey over the real Supabase database with the demo seed
// applied: buscar -> confirmar la operación -> volver a verla con el código
// público -> convertirla en lead -> abrirla en el panel.
//
// The gate it defends is criterion 7 of the master plan: the customer and the
// seller must see exactly the same frozen operation.
//
// Cada prueba corre dentro de su propia transacción de Postgres que nunca se
// confirma: se ejecuta contra la base real de Supabase (la misma que usa
// producción), pero termina siempre en ROLLBACK, así que no deja rastro ni
// depende de qué datos existan ya de una siembra manual previa.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import postgres from "postgres";

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
        url: pathToFileURL(
          resolve(
            projectRoot,
            specifier === "@/db"
              ? "db/index.ts"
              : specifier === "@/lib/admin"
                ? "lib/admin/index.ts"
                : relative.endsWith(".mjs")
                  ? relative
                  : `${relative}.ts`,
          ),
        ).href,
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

const { drizzle } = await import("drizzle-orm/postgres-js");
const schema = await import("../db/schema.ts");
const { SUPABASE_POSTGRES_OPTIONS, SupabaseD1Database } = await import("../db/supabase-remote.ts");
const { createRepositories } = await import("../lib/data/repositories.ts");
const { D1LeadConversionRepository } = await import("../lib/data/lead-conversion-repository.ts");
const { D1LeadContextReadRepository } = await import("../lib/data/lead-context-read-repository.ts");
const { applicationDependencies } = await import("../lib/server/affordability.ts");
const { createSimulationResponse } = await import("../lib/server/simulation-api.ts");
const { createLeadResponse } = await import("../lib/server/lead-conversion.ts");
const { getAdminLeadDetailData } = await import("../lib/server/admin-panel-data.ts");
const { publicSimulationView, normalizePublicCode } = await import(
  "../lib/server/public-simulation.ts"
);
const { getConversionFunnel } = await import("../lib/server/funnel-data.ts");
const { searchAffordability } = await import("../lib/application/index.mjs");
const { buildDemoSeedSql } = await import("../scripts/seed-demo-d1.mjs");

const NOW = new Date("2026-08-19T15:00:00.000Z");

const connectionString = process.env.SUPABASE_DB_URL;
const skip = !connectionString;
if (skip) {
  console.warn("SUPABASE_DB_URL no está configurada: se omite la prueba comercial de punta a punta.");
}

function suite(name, fn) {
  test(name, { skip }, fn);
}

let rootSql;
function getRootSql() {
  rootSql ??= postgres(connectionString, { ssl: "require", max: 1, ...SUPABASE_POSTGRES_OPTIONS });
  return rootSql;
}
test.after(async () => {
  if (rootSql) await rootSql.end({ timeout: 5 });
});

// Corre `fn` dentro de una transacción de Postgres que nunca se confirma: al
// terminar `fn` (con éxito o con una aserción fallida), la transacción entera
// se revierte, así que la base real de Supabase queda intacta pase lo que
// pase adentro.
const ROLLBACK = Symbol("e2e-journey-rollback");
async function withDatabase(fn) {
  let result;
  try {
    await getRootSql().begin(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result;
}

// `postgres.js` only attaches `.options` (the type parser/serializer tables
// drizzle-orm/postgres-js mutates on construction) to the root client, not to
// the scoped tag `sql.begin()` hands its callback; sharing the root client's
// object is safe since those overrides are idempotent. Likewise the scoped
// tag exposes `.savepoint()` instead of `.begin()` for nested transactions —
// `SupabaseD1Database.batch()` calls `.begin()`, so a savepoint stands in for
// it here, exactly as a real nested transaction would.
function asD1Sql(tx) {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "begin") return target.savepoint.bind(target);
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function seededAccess(tx) {
  tx.options ??= getRootSql().options;
  const binding = new SupabaseD1Database({ connectionString: "", sql: asD1Sql(tx) });
  await binding.exec(buildDemoSeedSql(NOW));
  const db = drizzle(tx, { schema });
  const repositories = createRepositories(db);
  return {
    source: "d1",
    ...repositories,
    leadConversions: new D1LeadConversionRepository(binding),
    binding,
    db,
    async recordConsent() {},
    async recordLeadEvent() {
      return true;
    },
  };
}

function simulationRequest(command, key) {
  return new Request("http://localhost/api/v1/simulations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(command),
  });
}

function leadRequest(body, key) {
  return new Request("http://localhost/api/v1/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

async function confirmOperation(access) {
  const dependencies = await applicationDependencies(access, NOW);
  const search = await searchAffordability(
    {
      evaluatedAt: NOW.toISOString(),
      cashCents: 900_000_000,
      accreditedDepositCents: 0,
      maxMonthlyPaymentCents: 90_000_000,
      acceptedTerms: [12, 24, 36],
      preferences: {},
    },
    dependencies,
  );
  const selected = search.results.find(({ status }) => status !== "NOT_ELIGIBLE");
  assert.ok(selected, "el stock demo debe ofrecer al menos una opción alcanzable");

  const response = await createSimulationResponse(
    simulationRequest(
      {
        vehicleId: selected.vehicle.id,
        vehicleSlug: selected.vehicle.slug,
        selectionVersion: selected.selectionVersion,
        simulationInput: search.simulationInput,
      },
      "e2e-journey-simulation",
    ),
    {
      access,
      dependencies,
      now: NOW,
      idGenerator: () => "e2e-simulation-1",
      codeGenerator: () => "JD-E2E001",
    },
  );
  assert.equal(response.status, 201);
  return { body: await response.json(), vehicle: selected.vehicle };
}

suite("el cliente y el vendedor ven la misma operación congelada", async () => {
  await withDatabase(async (tx) => {
    const access = await seededAccess(tx);
    const { body: created, vehicle } = await confirmOperation(access);
    const code = created.data.simulationCode ?? created.data.code ?? "JD-E2E001";

    // El cliente vuelve con el código que la web le mostró al confirmar.
    const normalized = normalizePublicCode(` ${code.toLowerCase()} `);
    assert.equal(normalized, code);
    const stored = await access.simulations.findByPublicCode(normalized);
    assert.ok(stored, "el código público debe resolver el snapshot persistido");
    const published = await access.stock.listAvailable();
    const customer = publicSimulationView(
      stored,
      published.find((item) => item.id === stored.vehicleId) ?? null,
      NOW,
    );

    // El vendedor abre la misma operación desde el panel, con lead vinculado.
    const leadResponse = await createLeadResponse(
      leadRequest(
        {
          name: "Cliente E2E",
          phone: "2494587046",
          contactConsent: true,
          source: "SIMULADOR_WEB",
          simulationCode: code,
          vehicleSlug: vehicle.slug,
        },
        "e2e-journey-lead",
      ),
      { access, now: NOW, idGenerator: () => "e2e-lead-1" },
    );
    assert.equal(leadResponse.status, 201);
    const leadBody = await leadResponse.json();
    const leadId = leadBody.data.id;

    const { lead } = await getAdminLeadDetailData(leadId, {
      repository: new D1LeadContextReadRepository(access.db),
      authorize: async () => ({ email: "vendedor@jda.test" }),
      now: NOW,
    });
    assert.ok(lead.operation, "el panel debe mostrar la operación vinculada");

    // Criterio 7: los importes del cliente y del vendedor son los mismos.
    assert.equal(lead.operation.simulationCode, customer.publicCode);
    assert.deepEqual(customer.amounts, lead.operation.amounts);
    assert.equal(customer.termMonths, lead.operation.termMonths);
    assert.equal(customer.classification, lead.operation.classification);
    assert.equal(customer.certaintyLevel, lead.operation.certaintyLevel);
    assert.equal(customer.disclaimer, lead.operation.disclaimer);
    assert.equal(customer.expiresAt, lead.operation.expiresAt);
    assert.equal(customer.expired, lead.operation.validity === "EXPIRED");

    // La vista pública no lleva datos del lead ni hashes internos.
    const serialized = JSON.stringify(customer);
    assert.doesNotMatch(serialized, /Cliente E2E|2494587046/);
    assert.doesNotMatch(serialized, /idempotenc|leadId|inputSnapshot|resultSnapshot/i);
  });
});

suite("la operación vencida y la unidad retirada conservan el snapshot", async () => {
  await withDatabase(async (tx) => {
    const access = await seededAccess(tx);
    const { body: created } = await confirmOperation(access);
    const code = created.data.simulationCode ?? created.data.code ?? "JD-E2E001";
    const stored = await access.simulations.findByPublicCode(code);

    // La unidad deja de estar publicada: la web lo dice sin recalcular nada.
    await tx`UPDATE vehicle SET status = 'RESERVED' WHERE id = ${stored.vehicleId}`;
    const afterUnpublish = await access.stock.listAvailable();
    const retired = publicSimulationView(
      stored,
      afterUnpublish.find((item) => item.id === stored.vehicleId) ?? null,
      NOW,
    );
    assert.equal(retired.vehicleAvailable, false);
    assert.equal(retired.vehicleSlug, null, "una unidad retirada no se enlaza");
    assert.deepEqual(retired.amounts, publicSimulationView(stored, null, NOW).amounts);

    // Vencida: el estado cambia, los importes no.
    const later = new Date(Date.parse(stored.expiresAt) + 1000);
    const expired = publicSimulationView(stored, null, later);
    assert.equal(expired.expired, true);
    assert.deepEqual(expired.amounts, retired.amounts);
    assert.equal(expired.disclaimer, retired.disclaimer);
  });
});

suite("un código inexistente o mal formado no distingue sus casos", async () => {
  await withDatabase(async (tx) => {
    const access = await seededAccess(tx);

    assert.equal(normalizePublicCode("no"), null);
    assert.equal(normalizePublicCode("JD ../../panel"), null);
    assert.equal(normalizePublicCode("%E0%A4%A"), null);
    assert.equal(normalizePublicCode("jd-abc123"), "JD-ABC123");
    assert.equal(await access.simulations.findByPublicCode("JD-ABC123"), null);
  });
});

suite("el embudo del panel cuenta el recorrido que acaba de ocurrir", async () => {
  await withDatabase(async (tx) => {
    const access = await seededAccess(tx);
    const empty = await getConversionFunnel({ db: access.db, now: NOW });
    assert.equal(empty.empty, true);
    assert.deepEqual(
      empty.steps.map((step) => step.value),
      [0, 0, 0, 0, 0],
    );

    const { body: created, vehicle } = await confirmOperation(access);
    const code = created.data.simulationCode ?? created.data.code ?? "JD-E2E001";
    const leadResponse = await createLeadResponse(
      leadRequest(
        {
          name: "Cliente Embudo",
          phone: "2494587046",
          contactConsent: true,
          source: "SIMULADOR_WEB",
          simulationCode: code,
          vehicleSlug: vehicle.slug,
        },
        "e2e-funnel-lead",
      ),
      { access, now: NOW, idGenerator: () => "e2e-funnel-lead-1" },
    );
    assert.equal(leadResponse.status, 201);

    // The production schema owns creation timestamps through now(). Pin the
    // persisted journey to this test's clock before applying the exclusive
    // upper bound used by the analytics window.
    await tx`UPDATE simulation SET created_at = ${NOW.toISOString()} WHERE id = 'e2e-simulation-1'`;
    await tx`UPDATE lead SET created_at = ${NOW.toISOString()} WHERE id = 'e2e-funnel-lead-1'`;
    await tx`UPDATE lead_interest SET created_at = ${NOW.toISOString()} WHERE lead_id = 'e2e-funnel-lead-1'`;

    const funnel = await getConversionFunnel({ db: access.db, now: new Date(NOW.getTime() + 1) });
    const value = (key) => funnel.steps.find((step) => step.key === key).value;
    assert.equal(funnel.empty, false);
    assert.equal(value("simulations"), 1);
    assert.equal(value("linkedLeads"), 1);
    assert.equal(value("handoffs"), 0, "sin handoff registrado el paso queda en cero");
    assert.equal(value("contacted"), 0, "el lead nace en NEW hasta que el equipo lo mueve");
    assert.equal(funnel.breakdowns.channels.find((row) => row.label === "SIMULADOR_WEB")?.leads, 1);
    assert.equal(funnel.breakdowns.vehicles[0]?.leads, 1);
    assert.notEqual(funnel.breakdowns.vehicles[0]?.label, "Sin vehículo");
    assert.equal(funnel.breakdowns.sellers.find((row) => row.label === "Sin asignar")?.leads, 1);

    // Contactar queda medido por el evento histórico aunque el estado mutable
    // termine después en LOST.
    const contactedAt = new Date(NOW.getTime() + 1).toISOString();
    await tx`
      INSERT INTO lead_event (id, lead_id, type, actor_type, metadata_json, occurred_at)
      VALUES ('event-contacted', 'e2e-funnel-lead-1', 'STATUS_CHANGED', 'USER', '{"to":"CONTACTED"}', ${contactedAt})
    `;
    await tx`
      INSERT INTO lead_event (id, lead_id, type, actor_type, metadata_json, occurred_at)
      VALUES ('event-lost', 'e2e-funnel-lead-1', 'STATUS_CHANGED', 'USER', '{"to":"LOST"}', ${contactedAt})
    `;
    await tx`UPDATE lead SET status = 'LOST', lost_reason = 'Eligió otra unidad' WHERE id = 'e2e-funnel-lead-1'`;
    const afterLoss = await getConversionFunnel({ db: access.db, now: new Date(NOW.getTime() + 2) });
    assert.equal(afterLoss.steps.find((step) => step.key === "contacted").value, 1);
    assert.equal(afterLoss.steps.find((step) => step.key === "won").value, 0);
    assert.equal(afterLoss.breakdowns.channels[0]?.contacted, 1);

    // Fuera de la ventana el recorrido deja de contarse, no se estima.
    const muchLater = new Date(NOW.getTime() + 90 * 86_400_000);
    const stale = await getConversionFunnel({ db: access.db, now: muchLater });
    assert.equal(stale.empty, true);
  });
});
