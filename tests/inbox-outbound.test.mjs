import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

const { sendOutboundMessage, escalateToHuman, handOverToAdvisor, windowIsOpen } = await import(
  "../lib/server/inbox-outbound.ts"
);
const { ZernioClient } = await import("../lib/server/zernio-client.ts");
const { D1ChannelInboxRepository } = await import("../lib/data/channel-inbox-repository.ts");
const { handleZernioWebhook } = await import("../lib/server/zernio-webhook.ts");

const SECRET = "un-secreto-de-webhook-suficientemente-largo";
const INBOUND_AT = "2026-09-03T12:00:00.000Z";
const NOW = new Date("2026-09-03T12:30:00.000Z");
const MUCH_LATER = new Date("2026-09-05T12:30:00.000Z");

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

function harness({ accountStatus = "ACTIVE", lastInboundAt = INBOUND_AT, platform = "whatsapp" } = {}) {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0012_mysterious_forge.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, path), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database
    .prepare(
      `INSERT INTO channel_account (id, provider, platform, external_account_id, display_name, status, default_assignee)
       VALUES ('acc-local', 'ZERNIO', ?, 'zernio-acc-1', 'JDA WhatsApp', ?, 'vendedor@jda.test')`,
    )
    .run(platform, accountStatus);
  database
    .prepare(`INSERT INTO lead (id, name, phone_normalized, source) VALUES ('lead-1', 'Marina', '+5492494587046', 'INBOX_WHATSAPP')`)
    .run();
  database
    .prepare(
      `INSERT INTO inbox_conversation
         (id, provider, external_conversation_id, channel_account_id, platform,
          participant_external_id, participant_phone_normalized, lead_id, status, handling,
          assigned_to, last_inbound_at)
       VALUES ('conv-local', 'ZERNIO', 'conv-1', 'acc-local', ?, '5492494587046', '+5492494587046',
               'lead-1', 'OPEN', 'AI', 'vendedor@jda.test', ?)`,
    )
    .run(platform, lastInboundAt);

  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const sends = [];
  const client = {
    async sendText(input) {
      sends.push({ kind: "text", ...input });
      return { externalMessageId: `zmsg-${sends.length}`, externalConversationId: "conv-1" };
    },
    async startWithTemplate(input) {
      sends.push({ kind: "template", ...input });
      return { externalMessageId: `ztpl-${sends.length}`, externalConversationId: "conv-1" };
    },
  };
  const hits = new Map();
  const rateLimiter = {
    async hit({ key }) {
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      return { hits: next };
    },
    async removeExpired() {},
  };
  let index = 0;
  const newId = () => `out-${(index += 1)}`;
  return {
    database,
    repository,
    client,
    sends,
    rateLimiter,
    runtime: { repository, client, rateLimiter, now: NOW, newId },
    rows: (sql) => database.prepare(sql).all(),
  };
}

test("dentro de la ventana el saliente sale como texto y queda citado en la bandeja", async () => {
  const { runtime, sends, rows } = harness();
  const result = await sendOutboundMessage(
    {
      conversationId: "conv-local",
      text: "Te paso tres opciones que entran en tu presupuesto",
      author: { type: "AI", id: "asesor" },
      idempotencyKey: "key-1",
    },
    runtime,
  );
  assert.equal(result.usedTemplate, false);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].kind, "text");
  assert.equal(sends[0].externalConversationId, "conv-1");
  assert.equal(sends[0].idempotencyKey, "key-1");

  const [message] = rows("SELECT * FROM inbox_message");
  assert.equal(message.direction, "outgoing");
  assert.equal(message.author_type, "AI");
  assert.equal(message.author_id, "asesor");
  assert.equal(message.external_message_id, "zmsg-1");

  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.last_outbound_at, NOW.toISOString());

  const [leadEvent] = rows("SELECT * FROM lead_event");
  assert.equal(leadEvent.type, "INBOX_MESSAGE_SENT");
  assert.equal(leadEvent.actor_type, "SYSTEM");
});

test("fuera de la ventana de 24 horas no sale texto libre", async () => {
  const { runtime, sends, rows } = harness();
  await assert.rejects(
    () =>
      sendOutboundMessage(
        {
          conversationId: "conv-local",
          text: "¿Seguís interesada?",
          author: { type: "SELLER", id: "vendedor@jda.test" },
          idempotencyKey: "key-2",
        },
        { ...runtime, now: MUCH_LATER },
      ),
    (error) => error.code === "TEMPLATE_REQUIRED" && error.status === 409,
  );
  assert.equal(sends.length, 0, "no se llama al proveedor cuando la ventana está cerrada");
  assert.equal(rows("SELECT * FROM inbox_message").length, 0);
});

test("fuera de la ventana, con plantilla aprobada, sale por el alta de conversación", async () => {
  const { runtime, sends } = harness();
  const result = await sendOutboundMessage(
    {
      conversationId: "conv-local",
      text: "Hola Marina, entró una unidad que coincide con lo que buscabas",
      author: { type: "SELLER", id: "vendedor@jda.test" },
      idempotencyKey: "key-3",
      template: { name: "coincidencia_stock", language: "es_AR", params: ["Marina", "Amarok 2018"] },
    },
    { ...runtime, now: MUCH_LATER },
  );
  assert.equal(result.usedTemplate, true);
  assert.equal(sends[0].kind, "template");
  assert.equal(sends[0].participantId, "5492494587046");
  assert.deepEqual(sends[0].template.params, ["Marina", "Amarok 2018"]);
});

test("el ritmo por destinatario se frena antes de que lo rechace WhatsApp", async () => {
  const { runtime, sends } = harness();
  for (let index = 0; index < 8; index += 1) {
    await sendOutboundMessage(
      {
        conversationId: "conv-local",
        text: `mensaje ${index}`,
        author: { type: "AI", id: "asesor" },
        idempotencyKey: `key-pace-${index}`,
      },
      runtime,
    );
  }
  await assert.rejects(
    () =>
      sendOutboundMessage(
        {
          conversationId: "conv-local",
          text: "uno más",
          author: { type: "AI", id: "asesor" },
          idempotencyKey: "key-pace-9",
        },
        runtime,
      ),
    (error) =>
      error.code === "RECIPIENT_PACE_EXCEEDED" &&
      error.status === 429 &&
      typeof error.headers["Retry-After"] === "string",
  );
  assert.equal(sends.length, 8, "el noveno no llega al proveedor");
});

test("el webhook posterior no duplica el saliente que ya registramos", async () => {
  const { runtime, repository, rows } = harness();
  await sendOutboundMessage(
    {
      conversationId: "conv-local",
      text: "Te espero el jueves",
      author: { type: "SELLER", id: "vendedor@jda.test" },
      idempotencyKey: "key-4",
    },
    runtime,
  );

  const body = JSON.stringify({
    id: "evt-sent",
    event: "message.sent",
    timestamp: NOW.toISOString(),
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
    conversation: {
      id: "conv-1",
      platform: "whatsapp",
      platformConversationId: "wa-1",
      participantId: "5492494587046",
      status: "open",
    },
    message: {
      id: "zmsg-1",
      conversationId: "conv-1",
      platform: "whatsapp",
      platformMessageId: "wamid.out",
      direction: "outgoing",
      text: "Te espero el jueves",
      attachments: [],
      sender: {},
      sentAt: NOW.toISOString(),
      isRead: false,
    },
  });
  const response = await handleZernioWebhook(
    new Request("http://localhost/api/v1/webhooks/zernio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zernio-Signature": createHmac("sha256", SECRET).update(body).digest("hex"),
      },
      body,
    }),
    { repository, secret: SECRET, now: NOW, newId: () => `wh-${Math.random()}` },
  );
  assert.equal(response.status, 200);
  const messages = rows("SELECT * FROM inbox_message");
  assert.equal(messages.length, 1, "sigue habiendo un solo saliente");
  assert.equal(messages[0].author_type, "SELLER", "el autor real no se pisa con BUSINESS");
});

test("la escalada pasa la conversación a una persona y deja el motivo asentado", async () => {
  const { runtime, rows } = harness();
  await escalateToHuman(
    { conversationId: "conv-local", reason: "INTENCION_ALTA", assignTo: "jesus@jda.test" },
    runtime,
  );
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.handling, "HUMAN");
  assert.equal(conversation.assigned_to, "jesus@jda.test", "la escalada explícita reasigna");

  const [event] = rows("SELECT * FROM lead_event WHERE type = 'INBOX_ESCALATED'");
  assert.equal(event.lead_id, "lead-1");
  assert.equal(JSON.parse(event.metadata_json).reason, "INTENCION_ALTA");
});

test("una escalada sin destinatario explícito conserva al vendedor asignado", async () => {
  const { runtime, rows } = harness();
  await escalateToHuman({ conversationId: "conv-local", reason: "PIDE_HABLAR_CON_PERSONA" }, runtime);
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.handling, "HUMAN");
  assert.equal(conversation.assigned_to, "vendedor@jda.test");
});

test("no se le pasa una conversación al asesor si no puede responder", async () => {
  const { runtime } = harness();
  await assert.rejects(
    () => handOverToAdvisor({ conversationId: "conv-local" }, { ...runtime, now: MUCH_LATER }),
    (error) => error.code === "WINDOW_CLOSED",
  );
  await handOverToAdvisor({ conversationId: "conv-local" }, runtime);
});

test("una cuenta inactiva no envía", async () => {
  const { runtime, sends } = harness({ accountStatus: "DISABLED" });
  await assert.rejects(
    () =>
      sendOutboundMessage(
        {
          conversationId: "conv-local",
          text: "hola",
          author: { type: "AI", id: "asesor" },
          idempotencyKey: "key-5",
        },
        runtime,
      ),
    (error) => error.code === "CHANNEL_ACCOUNT_INACTIVE",
  );
  assert.equal(sends.length, 0);
});

test("en Instagram no rige la ventana de 24 horas de WhatsApp", () => {
  const context = { platform: "instagram", lastInboundAt: null };
  assert.equal(windowIsOpen(context, NOW), true);
  assert.equal(windowIsOpen({ platform: "whatsapp", lastInboundAt: null }, NOW), false);
});

test("el cliente traduce el rechazo por ráfaga y el rechazo de credenciales", async () => {
  const paced = new ZernioClient({
    apiKey: "clave-de-prueba-suficiente",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "too many", code: "PLATFORM_ERROR", platformError: { code: 131056 } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(
    () =>
      paced.sendText({
        externalConversationId: "conv-1",
        externalAccountId: "acc",
        text: "hola",
        idempotencyKey: "k",
      }),
    (error) => error.code === "RECIPIENT_PACE_EXCEEDED" && error.status === 429,
  );

  const unauthorized = new ZernioClient({
    apiKey: "clave-de-prueba-suficiente",
    fetchImpl: async () => new Response("", { status: 401 }),
  });
  await assert.rejects(
    () =>
      unauthorized.sendText({
        externalConversationId: "conv-1",
        externalAccountId: "acc",
        text: "hola",
        idempotencyKey: "k",
      }),
    (error) => error.code === "MESSAGING_NOT_CONFIGURED" && error.status === 503,
  );

  const withoutKey = new ZernioClient({ apiKey: "" });
  await assert.rejects(
    () =>
      withoutKey.sendText({
        externalConversationId: "conv-1",
        externalAccountId: "acc",
        text: "hola",
        idempotencyKey: "k",
      }),
    (error) => error.code === "MESSAGING_NOT_CONFIGURED",
  );
});
