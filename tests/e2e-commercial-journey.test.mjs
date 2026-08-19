// Prueba comercial de punta a punta (Hito 8).
//
// One customer journey over a real SQLite database with every migration and
// the demo seed applied: buscar -> confirmar la operación -> volver a verla
// con el código público -> convertirla en lead -> abrirla en el panel.
//
// The gate it defends is criterion 7 of the master plan: the customer and the
// seller must see exactly the same frozen operation.
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

const { drizzle } = await import("drizzle-orm/d1");
const schema = await import("../db/schema.ts");
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
const MIGRATIONS = [
  "0000_chemical_tiger_shark.sql",
  "0001_worried_valkyrie.sql",
  "0002_seed_demo_publication.sql",
  "0003_confirm_jda_whatsapp.sql",
  "0004_furry_ultimatum.sql",
  "0005_lucky_exiles.sql",
  "0006_nostalgic_scarlet_spider.sql",
  "0007_appraisal_media_capture.sql",
];

function uniqueAliasQuery(sql, columns) {
  const names = columns.map((column) => column.name);
  if (new Set(names).size === names.length) return sql;
  if (columns.some((column) => !column.table || !column.column)) return sql;
  const from = sql.search(/\sfrom\s/i);
  const select = sql.search(/select\s/i);
  if (select < 0 || from < 0) return sql;
  const list = columns
    .map((column, index) => `"${column.table}"."${column.column}" as "c${index}"`)
    .join(", ");
  return `${sql.slice(0, select)}select ${list}${sql.slice(from)}`;
}

// Minimal D1 surface over node:sqlite so the production Drizzle repositories
// run unchanged: the journey must exercise the real persistence code.
function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) {
        return statement(sql, values);
      },
      async first() {
        return database.prepare(sql).get(...bindings) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...bindings), success: true, meta: {} };
      },
      async raw(options) {
        // node:sqlite returns rows as objects, so a join that selects "id"
        // from two tables collapses both into one key and every positional
        // value after it shifts. D1 hands Drizzle positional arrays, so the
        // select list is rewritten with unique aliases before reading it.
        const prepared = database.prepare(sql);
        const columns = prepared.columns();
        const aliased = uniqueAliasQuery(sql, columns);
        const rows = database.prepare(aliased).all(...bindings);
        const keys =
          aliased === sql
            ? columns.map((column) => column.name)
            : columns.map((_, index) => `c${index}`);
        const values = rows.map((row) => keys.map((key) => row[key]));
        if (!options?.columnNames) return values;
        return [columns.map((column) => column.name), ...values];
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(sql) {
      return statement(sql);
    },
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

function seededDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const file of MIGRATIONS) {
    database.exec(
      readFileSync(resolve(projectRoot, "drizzle", file), "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  database.exec(buildDemoSeedSql(NOW));
  return database;
}

function accessFor(database) {
  const binding = sqliteD1(database);
  const db = drizzle(binding, { schema });
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

test("el cliente y el vendedor ven la misma operación congelada", async () => {
  const database = seededDatabase();
  const access = accessFor(database);
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

test("la operación vencida y la unidad retirada conservan el snapshot", async () => {
  const database = seededDatabase();
  const access = accessFor(database);
  const { body: created } = await confirmOperation(access);
  const code = created.data.simulationCode ?? created.data.code ?? "JD-E2E001";
  const stored = await access.simulations.findByPublicCode(code);

  // La unidad deja de estar publicada: la web lo dice sin recalcular nada.
  database.prepare("UPDATE vehicle SET status = 'RESERVED' WHERE id = ?").run(stored.vehicleId);
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

test("un código inexistente o mal formado no distingue sus casos", async () => {
  const database = seededDatabase();
  const access = accessFor(database);

  assert.equal(normalizePublicCode("no"), null);
  assert.equal(normalizePublicCode("JD ../../panel"), null);
  assert.equal(normalizePublicCode("%E0%A4%A"), null);
  assert.equal(normalizePublicCode("jd-abc123"), "JD-ABC123");
  assert.equal(await access.simulations.findByPublicCode("JD-ABC123"), null);
});

test("el embudo del panel cuenta el recorrido que acaba de ocurrir", async () => {
  const database = seededDatabase();
  const access = accessFor(database);
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

  const funnel = await getConversionFunnel({ db: access.db, now: NOW });
  const value = (key) => funnel.steps.find((step) => step.key === key).value;
  assert.equal(funnel.empty, false);
  assert.equal(value("simulations"), 1);
  assert.equal(value("linkedLeads"), 1);
  assert.equal(value("handoffs"), 0, "sin handoff registrado el paso queda en cero");
  assert.equal(value("contacted"), 0, "el lead nace en NEW hasta que el equipo lo mueve");

  // Fuera de la ventana el recorrido deja de contarse, no se estima.
  const muchLater = new Date(NOW.getTime() + 90 * 86_400_000);
  const stale = await getConversionFunnel({ db: access.db, now: muchLater });
  assert.equal(stale.empty, true);
});
