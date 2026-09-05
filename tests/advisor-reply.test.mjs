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

const { handleZernioWebhook } = await import("../lib/server/zernio-webhook.ts");
const { replyIfAdvisorHandles } = await import("../lib/server/advisor-reply.ts");
const { D1ChannelInboxRepository } = await import("../lib/data/channel-inbox-repository.ts");

const SECRET = "un-secreto-de-webhook-suficientemente-largo";
const NOW = new Date("2026-09-03T12:00:00.000Z");
const MUCH_LATER = new Date("2026-09-06T12:00:00.000Z");

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

function harness({ handling = "AI" } = {}) {
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
  database
    .prepare(
      `INSERT INTO inbox_conversation
         (id, provider, external_conversation_id, channel_account_id, platform,
          participant_external_id, participant_phone_normalized, status, handling, assigned_to, last_inbound_at)
       VALUES ('conv-local', 'ZERNIO', 'conv-1', 'acc-local', 'whatsapp', '5492494587046',
               '+5492494587046', 'OPEN', ?, 'vendedor@jda.test', ?)`,
    )
    .run(handling, NOW.toISOString());

  const repository = new D1ChannelInboxRepository(sqliteD1(database));
  const sends = [];
  const client = {
    async sendText(input) {
      sends.push(input);
      return { externalMessageId: `zmsg-${sends.length}`, externalConversationId: "conv-1" };
    },
    async startWithTemplate(input) {
      sends.push({ template: true, ...input });
      return { externalMessageId: `ztpl-${sends.length}`, externalConversationId: "conv-1" };
    },
  };
  const rateLimiter = { async hit() { return { hits: 1 }; }, async removeExpired() {} };
  return {
    database,
    repository,
    sends,
    outbound: { client, rateLimiter, newId: () => `out-${sends.length + 1}` },
    rows: (sql) => database.prepare(sql).all(),
  };
}

function modelSaying(text) {
  const seen = [];
  return {
    seen,
    model: {
      async createMessage(params) {
        seen.push(params);
        return { stop_reason: "end_turn", content: [{ type: "text", text }] };
      },
    },
  };
}

function inboundEvent(overrides = {}) {
  return {
    id: "evt-1",
    event: "message.received",
    timestamp: NOW.toISOString(),
    account: { id: "zernio-acc-1", accountId: "zernio-acc-1", platform: "whatsapp", username: "jda" },
    conversation: {
      id: "conv-1",
      platform: "whatsapp",
      platformConversationId: "wa-1",
      participantId: "5492494587046",
      participantName: "Marina",
      status: "open",
    },
    message: {
      id: "msg-1",
      conversationId: "conv-1",
      platform: "whatsapp",
      platformMessageId: "wamid.1",
      direction: "incoming",
      text: "Hola, busco algo automático",
      attachments: [],
      sender: {},
      sentAt: NOW.toISOString(),
      isRead: false,
    },
    ...overrides,
  };
}

function post(body, runtime) {
  const raw = JSON.stringify(body);
  return handleZernioWebhook(
    new Request("http://localhost/api/v1/webhooks/zernio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zernio-Signature": createHmac("sha256", SECRET).update(raw).digest("hex"),
      },
      body: raw,
    }),
    { secret: SECRET, now: NOW, ...runtime },
  );
}

test("un mensaje entrante en modo asesor se contesta y queda registrado", async () => {
  const { repository, sends, outbound, rows } = harness({ handling: "AI" });
  const { model, seen } = modelSaying("Contame de cuánto disponés y qué cuota podés pagar");

  const response = await post(inboundEvent(), {
    repository,
    advisorReply: { outbound, advisor: { model } },
  });
  assert.equal(response.status, 200);

  assert.equal(seen.length, 1, "se le preguntó al modelo una vez");
  assert.equal(sends.length, 1, "salió un único mensaje");
  assert.equal(sends[0].text, "Contame de cuánto disponés y qué cuota podés pagar");
  assert.equal(sends[0].idempotencyKey, "advisor:msg-1");

  const salientes = rows("SELECT * FROM inbox_message WHERE direction = 'outgoing'");
  assert.equal(salientes.length, 1);
  assert.equal(salientes[0].author_type, "AI");
  assert.equal(salientes[0].author_id, "asesor");
});

test("el mensaje del cliente no se le pasa dos veces al modelo", async () => {
  const { repository, outbound } = harness({ handling: "AI" });
  const { model, seen } = modelSaying("dale");
  await post(inboundEvent(), { repository, advisorReply: { outbound, advisor: { model } } });

  const mensajes = seen[0].messages;
  const repetidos = mensajes.filter(
    (message) => message.role === "user" && message.content === "Hola, busco algo automático",
  );
  assert.equal(repetidos.length, 1, "una sola copia del mensaje entrante");
});

test("por defecto nadie recibe respuesta automática: las conversaciones son humanas", async () => {
  const { repository, sends, outbound } = harness({ handling: "HUMAN" });
  const { model, seen } = modelSaying("no debería salir");

  const response = await post(inboundEvent(), {
    repository,
    advisorReply: { outbound, advisor: { model } },
  });
  assert.equal(response.status, 200);
  assert.equal(seen.length, 0, "ni siquiera se le pregunta al modelo");
  assert.equal(sends.length, 0);
});

test("con la ventana cerrada el asesor no gasta un turno de modelo", async () => {
  const { repository, sends, outbound } = harness({ handling: "AI" });
  const { model, seen } = modelSaying("no debería salir");
  const outcome = await replyIfAdvisorHandles(
    { conversationId: "conv-local", message: "hola", inboundMessageId: "msg-x" },
    { repository, outbound, advisor: { model }, now: MUCH_LATER },
  );
  assert.deepEqual(outcome, { status: "skipped", reason: "WINDOW_CLOSED" });
  assert.equal(seen.length, 0);
  assert.equal(sends.length, 0);
});

test("si el asesor escala, no se manda texto y la conversación pasa a una persona", async () => {
  const { repository, sends, outbound, rows } = harness({ handling: "AI" });
  const model = {
    async createMessage() {
      return { stop_reason: "end_turn", content: [] };
    },
  };
  const outcome = await replyIfAdvisorHandles(
    { conversationId: "conv-local", message: "quiero señar", inboundMessageId: "msg-y" },
    { repository, outbound, advisor: { model }, now: NOW },
  );
  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.reason, "escalated_no_reply");
  assert.equal(sends.length, 0, "al cliente no le llega nada");
  const [conversation] = rows("SELECT * FROM inbox_conversation");
  assert.equal(conversation.handling, "HUMAN");
});

test("sin asesor configurado la conversación no queda muda: se marca para una persona", async () => {
  const { repository, sends, outbound } = harness({ handling: "AI" });
  const outcome = await replyIfAdvisorHandles(
    { conversationId: "conv-local", message: "hola", inboundMessageId: "msg-z" },
    { repository, outbound, advisor: { apiKey: "" }, now: NOW },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "ADVISOR_UNAVAILABLE");
  assert.equal(sends.length, 0);
});

test("un reintento del mismo evento no vuelve a contestar", async () => {
  const { repository, sends, outbound } = harness({ handling: "AI" });
  const { model, seen } = modelSaying("una sola vez");
  await post(inboundEvent(), { repository, advisorReply: { outbound, advisor: { model } } });
  const replay = await post(inboundEvent(), {
    repository,
    advisorReply: { outbound, advisor: { model } },
  });
  assert.equal((await replay.json()).data.outcome, "replayed");
  assert.equal(seen.length, 1);
  assert.equal(sends.length, 1);
});
