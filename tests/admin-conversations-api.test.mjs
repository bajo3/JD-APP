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

const { adminConversationReply, adminConversationHandling, adminChannelAccounts } = await import(
  "../lib/server/admin-handlers.ts"
);
const { D1ChannelInboxRepository } = await import("../lib/data/channel-inbox-repository.ts");
const { D1RateLimitRepository } = await import("../lib/data/rate-limit-repository.ts");

const previousAllowlist = process.env.PANEL_ALLOWED_EMAILS;
process.env.PANEL_ALLOWED_EMAILS = "vendedor@jda.test";
test.after(() => {
  if (previousAllowlist === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
  else process.env.PANEL_ALLOWED_EMAILS = previousAllowlist;
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
    "drizzle/0010_rate_limit_windows.sql",
    "drizzle/0012_mysterious_forge.sql",
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
    { repository, now },
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
  const response = await adminConversationReply(request, "conv-open", { repository, now: new Date("2026-09-03T12:00:00.000Z") });
  assert.equal(response.status, 400);
});

test("escalar a persona exige motivo y lo asienta en la línea de tiempo del lead", async () => {
  const database = seedDatabase();
  conversation(database, { id: "conv-ai", lastInboundAt: "2026-09-03T11:00:00.000Z", handling: "AI" });
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const sinMotivo = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-ai/handling", { handling: "HUMAN" }),
    "conv-ai",
    { repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(sinMotivo.status, 422);

  const conMotivo = await adminConversationHandling(
    adminRequest("http://localhost/api/v1/admin/conversations/conv-ai/handling", {
      handling: "HUMAN",
      reason: "El cliente pidió hablar con una persona",
    }),
    "conv-ai",
    { repository, now: new Date("2026-09-03T12:00:00.000Z") },
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
    { repository, now: new Date("2026-09-03T12:00:00.000Z") },
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
    { repository, now: new Date("2026-09-03T12:00:00.000Z") },
  );
  assert.equal(response.status, 422);
  const row = database.prepare("SELECT handling FROM inbox_conversation WHERE id = 'conv-open'").get();
  assert.equal(row.handling, "HUMAN");
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
  const response = await adminChannelAccounts(request, { repository, now: new Date("2026-09-03T12:00:00.000Z") });
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
      { repository, now: new Date("2026-09-03T12:00:00.000Z") },
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
  const response = await adminChannelAccounts(request, { repository });
  assert.equal(response.status, 422);
  const row = database.prepare("SELECT id FROM channel_account WHERE external_account_id = 'acc-3'").get();
  assert.equal(row, undefined);
});

test("listar cuentas devuelve las cargadas", async () => {
  const database = seedDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const response = await adminChannelAccounts(adminGet("http://localhost/api/v1/admin/channel-accounts"), { repository });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].externalAccountId, "zernio-acc-1");
});
