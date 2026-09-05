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

const { handleZernioWebhook } = await import("../lib/server/zernio-webhook.ts");
const { D1ChannelInboxRepository } = await import("../lib/data/channel-inbox-repository.ts");

const SECRET = "un-secreto-de-webhook-suficientemente-largo";
const NOW = new Date("2026-09-03T12:00:00.000Z");

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

function inboxDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const path of [
    "drizzle-sqlite-archive/0000_chemical_tiger_shark.sql",
    "drizzle-sqlite-archive/0012_mysterious_forge.sql",
  ]) {
    database.exec(readFileSync(resolve(projectRoot, path), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  // `seq` es una columna propia del esquema de Postgres (reemplaza el `rowid`
  // implícito de SQLite como desempate estable); las migraciones archivadas no
  // la declaran, así que la base de pruebas la agrega con un trigger que la
  // sincroniza con el rowid real de cada inserción.
  database.exec(`
    ALTER TABLE inbox_message ADD COLUMN seq INTEGER;
    CREATE TRIGGER trg_inbox_message_seq AFTER INSERT ON inbox_message
    BEGIN
      UPDATE inbox_message SET seq = NEW.rowid WHERE rowid = NEW.rowid;
    END;
  `);
  database
    .prepare(
      `INSERT INTO channel_account (id, provider, platform, external_account_id, display_name, status, default_assignee)
       VALUES ('acc-local', 'ZERNIO', 'whatsapp', 'zernio-acc-1', 'JDA WhatsApp', 'ACTIVE', 'vendedor@jda.test')`,
    )
    .run();
  return database;
}

function counter(prefix) {
  let index = 0;
  return () => `${prefix}-${(index += 1)}`;
}

function webhookRequest(body, { signature, headers } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const computed = createHmac("sha256", SECRET).update(raw).digest("hex");
  return new Request("http://localhost/api/v1/webhooks/zernio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature === null ? {} : { "X-Zernio-Signature": signature ?? computed }),
      ...headers,
    },
    body: raw,
  });
}

function messageReceived(overrides = {}) {
  return {
    id: "evt-1",
    event: "message.received",
    timestamp: NOW.toISOString(),
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
    conversation: {
      id: "conv-1",
      platform: "whatsapp",
      platformConversationId: "wa-conv-1",
      participantId: "5492494587046",
      participantName: "Marina Díaz",
      status: "open",
    },
    message: {
      id: "msg-1",
      conversationId: "conv-1",
      platform: "whatsapp",
      platformMessageId: "wamid.1",
      direction: "incoming",
      text: "Hola, tengo una Suran 2013 y quiero algo automático",
      attachments: [],
      sender: { id: "5492494587046" },
      sentAt: "2026-09-03T11:59:00.000Z",
      isRead: false,
    },
    ...overrides,
  };
}

function harness() {
  const database = inboxDatabase();
  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const newId = counter("id");
  const call = (body, options) =>
    handleZernioWebhook(webhookRequest(body, options), {
      repository,
      secret: SECRET,
      now: NOW,
      newId,
    });
  const rows = (sql) => database.prepare(sql).all();
  const count = (table) => Number(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  return { database, repository, call, rows, count };
}

test("sin secreto configurado el puente no acepta nada", async () => {
  const { repository, count } = harness();
  const response = await handleZernioWebhook(webhookRequest(messageReceived()), {
    repository,
    secret: "",
    now: NOW,
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "WEBHOOK_NOT_CONFIGURED");
  assert.equal(count("channel_webhook_event"), 0);
});

test("firma ausente y firma incorrecta responden exactamente igual", async () => {
  const { call, count } = harness();
  const missing = await call(messageReceived(), { signature: null });
  const wrong = await call(messageReceived(), { signature: "a".repeat(64) });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await missing.json(), await wrong.json());
  assert.equal(count("channel_webhook_event"), 0);
  assert.equal(count("inbox_message"), 0);
});

test("un mensaje entrante crea conversación, mensaje, lead y evento de lead", async () => {
  const { call, rows, count } = harness();
  const response = await call(messageReceived());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { outcome: "processed" } });

  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.external_conversation_id, "conv-1");
  assert.equal(conversation.participant_phone_normalized, "+5492494587046");
  assert.equal(conversation.assigned_to, "vendedor@jda.test");
  assert.equal(conversation.last_inbound_at, "2026-09-03T11:59:00.000Z");
  assert.equal(conversation.last_outbound_at, null);

  const [message] = rows("SELECT * FROM inbox_message");
  assert.equal(message.conversation_id, conversation.id);
  assert.equal(message.direction, "incoming");
  assert.equal(message.author_type, "CUSTOMER");
  assert.match(message.text, /Suran 2013/);

  const [lead] = rows("SELECT * FROM lead");
  assert.equal(lead.id, conversation.lead_id);
  assert.equal(lead.name, "Marina Díaz");
  assert.equal(lead.phone_normalized, "+5492494587046");
  assert.equal(lead.source, "INBOX_WHATSAPP");
  assert.equal(lead.assigned_to, "vendedor@jda.test");

  const [leadEvent] = rows("SELECT * FROM lead_event");
  assert.equal(leadEvent.lead_id, lead.id);
  assert.equal(leadEvent.type, "INBOX_MESSAGE_RECEIVED");

  const [event] = rows("SELECT * FROM channel_webhook_event");
  assert.equal(event.status, "PROCESSED");
  assert.equal(count("inbox_conversation"), 1);
});

test("el reintento del mismo evento no vuelve a escribir", async () => {
  const { call, count } = harness();
  await call(messageReceived());
  const replay = await call(messageReceived());
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { data: { outcome: "replayed" } });
  assert.equal(count("inbox_message"), 1);
  assert.equal(count("lead"), 1);
  assert.equal(count("lead_event"), 1);
});

test("un segundo mensaje reusa la conversación y el lead", async () => {
  const { call, rows, count } = harness();
  await call(messageReceived());
  const second = await call(
    messageReceived({
      id: "evt-2",
      message: {
        ...messageReceived().message,
        id: "msg-2",
        platformMessageId: "wamid.2",
        text: "¿Tenés algo automático?",
        sentAt: "2026-09-03T12:05:00.000Z",
      },
    }),
  );
  assert.equal(second.status, 200);
  assert.equal(count("inbox_conversation"), 1);
  assert.equal(count("lead"), 1);
  assert.equal(count("inbox_message"), 2);
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.last_inbound_at, "2026-09-03T12:05:00.000Z");
  assert.equal(conversation.version, 2);
});

test("una cuenta que nadie dio de alta no se descarta: queda como no enrutada", async () => {
  const { call, rows, count } = harness();
  const response = await call(
    messageReceived({
      account: { id: "otra-cuenta", accountId: "otra-cuenta", platform: "whatsapp", username: "x" },
    }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    data: { outcome: "ignored", reason: "UNKNOWN_ACCOUNT" },
  });
  const [event] = rows("SELECT * FROM channel_webhook_event");
  assert.equal(event.status, "IGNORED");
  assert.equal(event.failure_reason, "UNKNOWN_ACCOUNT");
  assert.ok(event.payload_json.includes("otra-cuenta"));
  assert.equal(count("inbox_conversation"), 0);
  assert.equal(count("lead"), 0);
});

test("en Instagram el participante no es un teléfono y no se inventa uno", async () => {
  const { database, call, rows, count } = harness();
  database
    .prepare(
      `INSERT INTO channel_account (id, provider, platform, external_account_id, display_name, status)
       VALUES ('acc-ig', 'ZERNIO', 'instagram', 'zernio-acc-ig', 'JDA Instagram', 'ACTIVE')`,
    )
    .run();
  const response = await call(
    messageReceived({
      id: "evt-ig",
      account: { id: "zernio-acc-ig", accountId: "zernio-acc-ig", platform: "instagram", username: "jda" },
      conversation: {
        id: "conv-ig",
        platform: "instagram",
        platformConversationId: "ig-1",
        participantId: "17841400000000000",
        participantName: "seguidor",
        status: "open",
      },
      message: { ...messageReceived().message, id: "msg-ig", platform: "instagram" },
    }),
  );
  assert.equal(response.status, 201);
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.platform, "instagram");
  assert.equal(conversation.participant_phone_normalized, null);
  assert.equal(conversation.lead_id, null);
  assert.equal(count("lead"), 0);
  assert.equal(count("lead_event"), 0);
  assert.equal(count("inbox_message"), 1);
});

test("un saliente marca la conversación por su lado y no toca el entrante", async () => {
  const { call, rows } = harness();
  await call(messageReceived());
  const sent = await call(
    messageReceived({
      id: "evt-out",
      event: "message.sent",
      message: {
        ...messageReceived().message,
        id: "msg-out",
        platformMessageId: "wamid.out",
        direction: "outgoing",
        text: "Hola Marina, te contactamos",
        sentAt: "2026-09-03T12:10:00.000Z",
      },
    }),
  );
  assert.equal(sent.status, 200);
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.last_inbound_at, "2026-09-03T11:59:00.000Z");
  assert.equal(conversation.last_outbound_at, "2026-09-03T12:10:00.000Z");
  const outgoing = rows("SELECT * FROM inbox_message WHERE direction = 'outgoing'");
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].author_type, "BUSINESS");
  const events = rows("SELECT type FROM lead_event ORDER BY type");
  assert.deepEqual(events.map((row) => row.type), [
    "INBOX_MESSAGE_RECEIVED",
    "INBOX_MESSAGE_SENT",
  ]);
});

test("el estado de entrega actualiza el saliente y no inventa filas", async () => {
  const { call, rows } = harness();
  await call(messageReceived());
  await call(
    messageReceived({
      id: "evt-out",
      event: "message.sent",
      message: { ...messageReceived().message, id: "msg-out", direction: "outgoing" },
    }),
  );
  const delivered = await call({
    id: "evt-delivery",
    event: "message.delivered",
    timestamp: NOW.toISOString(),
    statusAt: "2026-09-03T12:11:00.000Z",
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
    conversation: { id: "conv-1", platformConversationId: "wa-conv-1", participantId: "5492494587046", status: "open" },
    message: { id: "msg-out", conversationId: "conv-1", platform: "whatsapp" },
  });
  assert.equal(delivered.status, 200);
  const [outgoing] = rows("SELECT * FROM inbox_message WHERE external_message_id = 'msg-out'");
  assert.equal(outgoing.delivery_status, "DELIVERED");

  const unknown = await call({
    id: "evt-delivery-2",
    event: "message.read",
    timestamp: NOW.toISOString(),
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
    conversation: { id: "conv-1", platformConversationId: "wa-conv-1", participantId: "5492494587046", status: "open" },
    message: { id: "msg-inexistente", conversationId: "conv-1", platform: "whatsapp" },
  });
  assert.equal(unknown.status, 202);
  assert.equal((await unknown.json()).data.reason, "MESSAGE_NOT_IN_INBOX");
});

test("un evento que no manejamos queda archivado, no descartado", async () => {
  const { call, rows } = harness();
  const response = await call({
    id: "evt-review",
    event: "review.new",
    timestamp: NOW.toISOString(),
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
  });
  assert.equal(response.status, 202);
  const [event] = rows("SELECT * FROM channel_webhook_event");
  assert.equal(event.type, "review.new");
  assert.equal(event.status, "IGNORED");
  assert.equal(event.failure_reason, "EVENT_NOT_HANDLED");
});

test("un evento que falló se puede reprocesar; uno procesado no", async () => {
  const { repository } = harness();
  const claim = {
    id: "evt-row",
    provider: "ZERNIO",
    externalEventId: "evt-x",
    type: "message.received",
    payloadHash: "hash",
    payloadJson: "{}",
    receivedAt: NOW.toISOString(),
  };
  assert.equal(await repository.claimEvent(claim), true);
  assert.equal(await repository.claimEvent({ ...claim, id: "evt-row-2" }), false);

  await repository.markEvent({
    provider: "ZERNIO",
    externalEventId: "evt-x",
    status: "FAILED",
    failureReason: "boom",
    processedAt: NOW.toISOString(),
  });
  assert.equal(await repository.claimEvent({ ...claim, id: "evt-row-3" }), true);

  await repository.markEvent({
    provider: "ZERNIO",
    externalEventId: "evt-x",
    status: "PROCESSED",
    failureReason: null,
    processedAt: NOW.toISOString(),
  });
  assert.equal(await repository.claimEvent({ ...claim, id: "evt-row-4" }), false);
});

test("un cuerpo que no es JSON válido no entra a la bandeja", async () => {
  const { call, count } = harness();
  const response = await call("no soy json");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_PAYLOAD");
  assert.equal(count("channel_webhook_event"), 0);
});
