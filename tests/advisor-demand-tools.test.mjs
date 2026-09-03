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
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]s$/.test(specifier) &&
      !String(context.parentURL ?? "").includes("/node_modules/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) {
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

const { createAdvisorSession, runAdvisorTool } = await import("../lib/server/advisor-tools.ts");
const { D1DemandRepository } = await import("../lib/data/demand-repository.ts");

const NOW = new Date("2026-09-03T12:00:00.000Z");
const DAY = 86_400_000;

function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) { return statement(sql, values); },
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

function harness({ leadId = "lead-1" } = {}) {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0012_mysterious_forge.sql",
    "drizzle/0013_dizzy_pretty_boy.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, path), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database
    .prepare(`INSERT INTO lead (id, name, phone_normalized, source) VALUES ('lead-1', 'Marina', '+5492494587046', 'INBOX_WHATSAPP')`)
    .run();
  database
    .prepare(
      `INSERT INTO channel_account (id, provider, platform, external_account_id, display_name, status)
       VALUES ('acc', 'ZERNIO', 'whatsapp', 'zernio-acc', 'JDA WhatsApp', 'ACTIVE')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO inbox_conversation
         (id, provider, external_conversation_id, channel_account_id, platform,
          participant_external_id, lead_id, status, handling, last_inbound_at)
       VALUES ('conv-local', 'ZERNIO', 'conv-1', 'acc', 'whatsapp', '5492494587046', ?, 'OPEN', 'AI', ?)`,
    )
    .run(leadId, NOW.toISOString());

  const demandRepository = new D1DemandRepository(sqliteD1(database));
  const session = createAdvisorSession();
  const context = {
    conversationId: "conv-local",
    session,
    now: NOW,
    demandRepository,
    outboundRuntime: {
      repository: {
        async findConversationForOutbound(id) {
          return {
            id,
            provider: "ZERNIO",
            externalConversationId: "conv-1",
            platform: "whatsapp",
            participantExternalId: "5492494587046",
            lastInboundAt: NOW.toISOString(),
            handling: "AI",
            assignedTo: "vendedor@jda.test",
            leadId,
            status: "OPEN",
            channelAccountId: "acc",
            externalAccountId: "zernio-acc",
            accountStatus: "ACTIVE",
          };
        },
      },
    },
  };
  return { database, context, session, rows: (sql) => database.prepare(sql).all() };
}

const AMAROK = {
  presupuestoMaximo: 25_000,
  moneda: "USD",
  marcas: ["Volkswagen"],
  modelos: ["Amarok"],
  anioMinimo: 2015,
  entregaUsado: true,
  descripcionUsado: "Gol 2012",
  diasParaComprar: 30,
};

test("sin contacto no se registra la demanda: primero se pide el teléfono", async () => {
  const { context, rows } = harness({ leadId: null });
  const result = await runAdvisorTool("registrar_demanda", AMAROK, context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "LEAD_REQUIRED");
  assert.equal(rows("SELECT * FROM buyer_passport").length, 0);
});

test("registrar deja un borrador y un resumen para leerle al cliente", async () => {
  const { context, session, rows } = harness();
  const result = await runAdvisorTool("registrar_demanda", AMAROK, context);
  assert.equal(result.ok, true);
  assert.match(result.data.resumen, /Amarok/);
  assert.match(result.data.resumen, /desde 2015/);
  assert.match(result.data.resumen, /hasta USD 25\.000/);
  assert.match(result.data.resumen, /entrega un usado/);
  assert.match(result.data.instruccion, /Leele el resumen/);

  const [passport] = rows("SELECT * FROM buyer_passport");
  assert.equal(passport.status, "DRAFT");
  assert.equal(passport.lead_id, "lead-1");
  assert.equal(passport.trade_in_description, "Gol 2012");
  assert.equal(rows("SELECT * FROM demand").length, 0, "todavía no hay demanda");
  assert.equal(session.pendingDemand.passportId, passport.id);
});

test("no se puede confirmar una demanda que el cliente nunca escuchó", async () => {
  const { context } = harness();
  const sinProponer = await runAdvisorTool("confirmar_demanda", { passportId: "inventado" }, context);
  assert.equal(sinProponer.code, "DEMAND_NOT_PROPOSED");

  await runAdvisorTool("registrar_demanda", AMAROK, context);
  const otro = await runAdvisorTool("confirmar_demanda", { passportId: "otro-id" }, context);
  assert.equal(otro.code, "DEMAND_NOT_PROPOSED");
});

test("recién con la confirmación del cliente queda registrada la demanda", async () => {
  const { context, session, rows } = harness();
  const registro = await runAdvisorTool("registrar_demanda", AMAROK, context);
  const confirmacion = await runAdvisorTool(
    "confirmar_demanda",
    { passportId: registro.data.passportId },
    context,
  );
  assert.equal(confirmacion.ok, true);
  assert.match(confirmacion.data.codigo, /^DEM-[A-Z0-9]{6}$/);
  assert.doesNotMatch(confirmacion.data.instruccion, /seguro|garantiz|en \d+ días/i);

  const [passport] = rows("SELECT * FROM buyer_passport");
  assert.equal(passport.status, "CONFIRMED");
  assert.equal(passport.confirmed_at, NOW.toISOString());

  const [demand] = rows("SELECT * FROM demand");
  assert.equal(demand.status, "OPEN");
  assert.equal(demand.lead_id, "lead-1");
  const criteria = JSON.parse(demand.criteria_json);
  assert.deepEqual(criteria.models, ["Amarok"]);
  assert.equal(criteria.maxPriceCents, 25_000_00);
  assert.equal(session.pendingDemand, null, "la propuesta se consume");
});

test("confirmar dos veces no duplica la demanda", async () => {
  const { context, rows } = harness();
  const registro = await runAdvisorTool("registrar_demanda", AMAROK, context);
  await runAdvisorTool("confirmar_demanda", { passportId: registro.data.passportId }, context);
  const otra = await runAdvisorTool(
    "confirmar_demanda",
    { passportId: registro.data.passportId },
    context,
  );
  assert.equal(otra.ok, false);
  assert.equal(otra.code, "DEMAND_NOT_PROPOSED");
  assert.equal(rows("SELECT * FROM demand").length, 1);
});

test("la vigencia sale del plazo que declaró el cliente, con un piso razonable", async () => {
  const treintaDias = harness();
  const registro = await runAdvisorTool(
    "registrar_demanda",
    { ...AMAROK, diasParaComprar: null },
    treintaDias.context,
  );
  await runAdvisorTool(
    "confirmar_demanda",
    { passportId: registro.data.passportId },
    treintaDias.context,
  );
  const [porDefecto] = treintaDias.rows("SELECT * FROM demand");
  assert.equal(porDefecto.valid_until, new Date(NOW.getTime() + 30 * DAY).toISOString());

  const apurado = harness();
  const registroApurado = await runAdvisorTool(
    "registrar_demanda",
    { ...AMAROK, diasParaComprar: 2 },
    apurado.context,
  );
  await runAdvisorTool(
    "confirmar_demanda",
    { passportId: registroApurado.data.passportId },
    apurado.context,
  );
  const [conPiso] = apurado.rows("SELECT * FROM demand");
  assert.equal(
    conPiso.valid_until,
    new Date(NOW.getTime() + 7 * DAY).toISOString(),
    "un cliente apurado no deja de existir a los dos días",
  );
});

test("una demanda sin ningún criterio real no se registra", async () => {
  const { context, rows } = harness();
  const result = await runAdvisorTool(
    "registrar_demanda",
    { presupuestoMaximo: 0, moneda: "USD" },
    context,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_DEMAND");
  assert.equal(rows("SELECT * FROM buyer_passport").length, 0);
});
