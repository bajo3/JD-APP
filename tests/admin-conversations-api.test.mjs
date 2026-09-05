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

const { adminConversationReply, adminConversationHandling, adminConversationWorkflow, adminChannelAccounts } = await import(
  "../lib/server/admin-handlers.ts"
);
const { D1ChannelInboxRepository } = await import("../lib/data/channel-inbox-repository.ts");
const { D1RateLimitRepository } = await import("../lib/data/rate-limit-repository.ts");

const previousAllowlist = process.env.PANEL_ALLOWED_EMAILS;
const previousAccountIds = process.env.PANEL_ALLOWED_ACCOUNT_IDS;
process.env.PANEL_ALLOWED_EMAILS = "vendedor@jda.test";
process.env.PANEL_ALLOWED_ACCOUNT_IDS = "seller-1";
test.after(() => {
  if (previousAllowlist === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
  else process.env.PANEL_ALLOWED_EMAILS = previousAllowlist;
  if (previousAccountIds === undefined) delete process.env.PANEL_ALLOWED_ACCOUNT_IDS;
  else process.env.PANEL_ALLOWED_ACCOUNT_IDS = previousAccountIds;
});

const adminAuth = Object.freeze({
  async readSession() {
    return {
      id: "seller-1", email: "vendedor@jda.test", name: "Vendedor JDA", phoneNormalized: null,
      leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
      lastLoginAt: null, version: 1, createdAt: "2026-09-04T00:00:00.000Z",
    };
  },
});

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

function seedDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0001_worried_valkyrie.sql",
    "drizzle/0004_furry_ultimatum.sql",
    "drizzle/0010_rate_limit_windows.sql",
    "drizzle/0012_mysterious_forge.sql",
    "drizzle/0014_flat_preak.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, path), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database
    .prepare(
      `INSERT INTO channel_account (id, provider, platform, external_account_id, display_name, status, default_assignee)
       VALUES ('acc-1', 'ZERNIO', 'whatsapp', 'zernio-acc-1', 'JDA WhatsApp', 'ACTIVE', 'vendedor@jda.test')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO lead (id, name, phone_normalized, source, status)
       VALUES ('lead-1', 'Marina Díaz', '+5492494587046', 'ZERNIO', 'NEW')`,
    )
    .run();
  return database;
}

function conversation(database, { id, lastInboundAt, handling = "HUMAN" }) {
  database
    .prepare(
      `INSERT INTO inbox_conversation
         (id, provider, external_conversation_id, channel_account_id, platform,
          participant_external_id, participant_phone_normalized, participant_display_name,
          lead_id, status, handling, last_inbound_at)
       VALUES (?, 'ZERNIO', ?, 'acc-1', 'whatsapp', '5492494587046', '+5492494587046', 'Marina Díaz',
               'lead-1', 'OPEN', ?, ?)`,
    )
    .run(id, `ext-${id}`, handling, lastInboundAt);
}

function adminRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "oai-authenticated-user-id": "seller-1",
      "oai-authenticated-user-email": "vendedor@jda.test",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

test("responder sin sesión de panel responde 401 y no manda nada", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-open", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const request = new Request("http://localhost/api/v1/admin/conversations/conv-open/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ text: "Hola" }),
  });
  const response = await adminConversationReply(request, "conv-open", { repository, now: new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(response.status, 401);
});

test("responder dentro de la ventana manda el mensaje por el circuito de salida", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-open", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const now = new Date("2026-09-03T12:00:00.000Z");
  const response = await adminConversationReply(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-open/reply", { text: "Hola, ¿en qué te ayudo?" }),
    "conv-open",
    {
      auth: adminAuth,
      repository,
      now,
      client: { async sendText() { return { externalMessageId: "wamid.out.1" }; } },
      rateLimiter: new D1RateLimitRepository(sqliteD1(database)),
    },
  );
  assert.equal(response.status, 200);
  const stored = database.prepare("SELECT author_type, author_id, text FROM inbox_message WHERE conversation_id = 'conv-open'").get();
  assert.equal(stored.author_type, "SELLER");
  assert.equal(stored.author_id, "vendedor@jda.test");
  assert.equal(stored.text, "Hola, ¿en qué te ayudo?");
});

test("responder fuera de la ventana de 24 horas sin plantilla responde 409 sin mandar nada", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-frio", lastInboundAt: "2026-08-01T00:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const now = new Date("2026-09-03T12:00:00.000Z");
  const response = await adminConversationReply(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-frio/reply", { text: "Hola" }),
    "conv-frio",
    { auth: adminAuth, repository, now },
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "TEMPLATE_REQUIRED");
  assert.equal(database.prepare("SELECT count(*) AS n FROM inbox_message WHERE conversation_id = 'conv-frio'").get().n, 0);
});

test("responder sin Idempotency-Key se rechaza antes de tocar el circuito de salida", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-open", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const request = new Request("http://localhost/api/v1/admin/conversations/conv-open/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "oai-authenticated-user-id": "seller-1",
      "oai-authenticated-user-email": "vendedor@jda.test",
    },
    body: JSON.stringify({ text: "Hola" }),
  });
  const response = await adminConversationReply(request, "conv-open", { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(response.status, 400);
});

test("escalar a persona exige motivo y lo asienta en la línea de tiempo del lead", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-ai", lastInboundAt: "2026-09-03T11:00:00.000Z", handling: "AI" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const sinMotivo = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-ai/handling", { handling: "HUMAN" }),
    "conv-ai",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(sinMotivo.status, 422);

  const conMotivo = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-ai/handling", {
      handling: "HUMAN",
      reason: "El cliente pidió hablar con una persona",
    }),
    "conv-ai",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(conMotivo.status, 200);
  const row = database.prepare("SELECT handling, assigned_to FROM inbox_conversation WHERE id = 'conv-ai'").get();
  assert.equal(row.handling, "HUMAN");
  assert.equal(row.assigned_to, "vendedor@jda.test");
  const event = database.prepare("SELECT type FROM lead_event WHERE lead_id = 'lead-1'").get();
  assert.equal(event.type, "INBOX_ESCALATED");
});

test("pasar al asesor se niega si la ventana está cerrada", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-frio", lastInboundAt: "2026-08-01T00:00:00.000Z", handling: "HUMAN" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-frio/handling", { handling: "AI" }),
    "conv-frio",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "WINDOW_CLOSED");
});

test("un modo inválido responde 422 sin tocar la conversación", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-open", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-open/handling", { handling: "ROBOT" }),
    "conv-open",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 422);
  const row = database.prepare("SELECT handling FROM inbox_conversation WHERE id = 'conv-open'").get();
  assert.equal(row.handling, "HUMAN");
});

test("asignarme toma la identidad de la sesión y mantiene lead y conversación alineados", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-assign", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-assign/workflow", {
      action: "assign-self",
      expectedVersion: 1,
      assignedTo: "persona-inyectada@atacante.test",
    }),
    "conv-assign",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 200);
  const row = database.prepare("SELECT assigned_to, version FROM inbox_conversation WHERE id = 'conv-assign'").get();
  assert.deepEqual({ ...row }, { assigned_to: "vendedor@jda.test", version: 2 });
  assert.equal(database.prepare("SELECT assigned_to FROM lead WHERE id = 'lead-1'").get().assigned_to, "vendedor@jda.test");
  assert.equal(database.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE resource_id = 'conv-assign'").get().n, 1);
  assert.equal(database.prepare("SELECT type FROM lead_event WHERE lead_id = 'lead-1'").get().type, "INBOX_ASSIGNED");
});

test("una versión vencida no asigna ni deja auditoría falsa", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-stale", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  database.prepare("UPDATE inbox_conversation SET version = 2 WHERE id = 'conv-stale'").run();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-stale/workflow", {
      action: "assign-self",
      expectedVersion: 1,
    }),
    "conv-stale",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ADMIN_VERSION_CONFLICT");
  assert.equal(database.prepare("SELECT assigned_to FROM inbox_conversation WHERE id = 'conv-stale'").get().assigned_to, null);
  assert.equal(database.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE resource_id = 'conv-stale'").get().n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM lead_event").get().n, 0);
});

test("el seguimiento es un recordatorio interno futuro, persistido y asignado", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-follow", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const past = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-follow/workflow", {
      action: "schedule-follow-up",
      expectedVersion: 1,
      followUpAt: "2026-09-03T11:59:00.000Z",
    }),
    "conv-follow",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(past.status, 422);

  const response = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-follow/workflow", {
      action: "schedule-follow-up",
      expectedVersion: 1,
      followUpAt: "2026-09-04T15:30:00.000Z",
      note: "Llamar cuando salga del trabajo",
    }),
    "conv-follow",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 200);
  const row = database.prepare(
    "SELECT assigned_to, follow_up_at, follow_up_note, version FROM inbox_conversation WHERE id = 'conv-follow'",
  ).get();
  assert.deepEqual({ ...row }, {
    assigned_to: "vendedor@jda.test",
    follow_up_at: "2026-09-04T15:30:00.000Z",
    follow_up_note: "Llamar cuando salga del trabajo",
    version: 2,
  });
  assert.equal(database.prepare("SELECT assigned_to FROM lead WHERE id = 'lead-1'").get().assigned_to, "vendedor@jda.test");
  const event = database.prepare("SELECT type, metadata_json FROM lead_event WHERE lead_id = 'lead-1'").get();
  assert.equal(event.type, "FOLLOW_UP_SCHEDULED");
  assert.deepEqual(JSON.parse(event.metadata_json), { dueAt: "2026-09-04T15:30:00.000Z", hasNote: true });
});

test("marcar perdida exige motivo y cierra conversación, lead y recordatorio juntos", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-lost", lastInboundAt: "2026-09-03T11:00:00.000Z" });
  database.prepare(
    "UPDATE inbox_conversation SET follow_up_at = '2026-09-04T15:30:00.000Z', follow_up_note = 'Llamar' WHERE id = 'conv-lost'",
  ).run();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const missing = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-lost/workflow", {
      action: "mark-lost",
      expectedVersion: 1,
      reason: " ",
    }),
    "conv-lost",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(missing.status, 422);

  const response = await adminConversationWorkflow(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-lost/workflow", {
      action: "mark-lost",
      expectedVersion: 1,
      reason: "Eligió otra unidad",
    }),
    "conv-lost",
    { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    { ...database.prepare("SELECT status, follow_up_at, follow_up_note, version FROM inbox_conversation WHERE id = 'conv-lost'").get() },
    { status: "CLOSED", follow_up_at: null, follow_up_note: null, version: 2 },
  );
  assert.deepEqual(
    { ...database.prepare("SELECT status, lost_reason FROM lead WHERE id = 'lead-1'").get() },
    { status: "LOST", lost_reason: "Eligió otra unidad" },
  );
  const audit = JSON.parse(database.prepare("SELECT summary_json FROM admin_audit_log WHERE resource_id = 'conv-lost'").get().summary_json);
  assert.deepEqual(audit, { to: "LOST", hasLostReason: true });
  const event = JSON.parse(database.prepare("SELECT metadata_json FROM lead_event WHERE lead_id = 'lead-1'").get().metadata_json);
  assert.deepEqual(event, { to: "LOST", lostReason: "Eligió otra unidad" });
});

function adminGet(url) {
  return new Request(url, {
    headers: {
      "oai-authenticated-user-id": "seller-1",
      "oai-authenticated-user-email": "vendedor@jda.test",
    },
  });
}

test("dar de alta una cuenta del canal sin sesión responde 401", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const request = new Request("http://localhost/api/v1/admin/channel-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ platform: "whatsapp", externalAccountId: "acc-2", displayName: "JDA Instagram" }),
  });
  const response = await adminChannelAccounts(request, { repository });
  assert.equal(response.status, 401);
});

test("dar de alta una cuenta nueva la deja ACTIVE con el vendedor como responsable por defecto", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const request = new Request("http://localhost/api/v1/admin/channel-accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "oai-authenticated-user-id": "seller-1",
      "oai-authenticated-user-email": "vendedor@jda.test",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ platform: "instagram", externalAccountId: "acc-ig-1", displayName: "JDA Instagram" }),
  });
  const response = await adminChannelAccounts(request, { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(response.status, 201);
  const row = database.prepare(
    "SELECT platform, display_name, status, default_assignee FROM channel_account WHERE external_account_id = 'acc-ig-1'",
  ).get();
  assert.equal(row.platform, "instagram");
  assert.equal(row.display_name, "JDA Instagram");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.default_assignee, "vendedor@jda.test");
});

test("reconectar la misma cuenta actualiza en lugar de duplicar", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const body = { platform: "whatsapp", externalAccountId: "acc-1", displayName: "JDA WhatsApp (reconectada)" };
  const send = () =>
    adminChannelAccounts(
      new Request("http://localhost/api/v1/admin/channel-accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "oai-authenticated-user-id": "seller-1",
          "oai-authenticated-user-email": "vendedor@jda.test",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
      { auth: adminAuth, repository, now: new Date("2026-09-03T12:00:00.000Z") },
    );
  await send();
  await send();
  const rows = database.prepare("SELECT display_name FROM channel_account WHERE external_account_id = 'acc-1'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "JDA WhatsApp (reconectada)");
});

test("un platform inválido se rechaza sin escribir nada", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const request = new Request("http://localhost/api/v1/admin/channel-accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "oai-authenticated-user-id": "seller-1",
      "oai-authenticated-user-email": "vendedor@jda.test",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ platform: "carrier-pigeon", externalAccountId: "acc-3", displayName: "Palomas JDA" }),
  });
  const response = await adminChannelAccounts(request, { auth: adminAuth, repository });
  assert.equal(response.status, 422);
  const row = database.prepare("SELECT id FROM channel_account WHERE external_account_id = 'acc-3'").get();
  assert.equal(row, undefined);
});

test("listar cuentas devuelve las cargadas", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminChannelAccounts(adminGet("http://localhost/api/v1/admin/channel-accounts"), { auth: adminAuth, repository });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].externalAccountId, "zernio-acc-1");
});
