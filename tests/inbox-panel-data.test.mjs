import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

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

const { slaFor, SLA_SOON_MINUTES, SLA_LATE_MINUTES, getConversationQueue, getConversationThread } = await import(
  "../lib/server/inbox-panel-data.ts"
);

const NOW = new Date("2026-09-03T12:00:00.000Z");

test("una conversación sin entrante nunca espera", () => {
  assert.deepEqual(slaFor(null, null, NOW), { waitingMinutes: null, sla: "answered" });
});

test("un saliente más nuevo que el entrante cierra la espera", () => {
  const result = slaFor("2026-09-03T11:00:00.000Z", "2026-09-03T11:30:00.000Z", NOW);
  assert.deepEqual(result, { waitingMinutes: null, sla: "answered" });
});

test("un saliente más viejo que el entrante sigue esperando respuesta", () => {
  const result = slaFor("2026-09-03T11:55:00.000Z", "2026-09-03T11:50:00.000Z", NOW);
  assert.equal(result.sla, "recent");
  assert.equal(result.waitingMinutes, 5);
});

test("el umbral de recién llegado a atender pronto es exacto, no aproximado", () => {
  const soon = new Date(NOW.getTime() - SLA_SOON_MINUTES * 60_000).toISOString();
  const before = new Date(NOW.getTime() - (SLA_SOON_MINUTES - 1) * 60_000).toISOString();
  assert.equal(slaFor(soon, null, NOW).sla, "soon");
  assert.equal(slaFor(before, null, NOW).sla, "recent");
});

test("el umbral de atender pronto a sin atender es exacto", () => {
  const late = new Date(NOW.getTime() - SLA_LATE_MINUTES * 60_000).toISOString();
  const before = new Date(NOW.getTime() - (SLA_LATE_MINUTES - 1) * 60_000).toISOString();
  assert.equal(slaFor(late, null, NOW).sla, "late");
  assert.equal(slaFor(before, null, NOW).sla, "soon");
});

test("una fecha ilegible no rompe el cálculo: se trata como contestada", () => {
  assert.deepEqual(slaFor("no-es-una-fecha", null, NOW), { waitingMinutes: null, sla: "answered" });
});

const previousAllowlist = process.env.PANEL_ALLOWED_EMAILS;
process.env.PANEL_ALLOWED_EMAILS = "vendedor@jda.test";
test.after(() => {
  if (previousAllowlist === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
  else process.env.PANEL_ALLOWED_EMAILS = previousAllowlist;
});

const AUTHORIZED_USER = {
  userId: "seller-1",
  displayName: "Vendedor JDA",
  email: "vendedor@jda.test",
  fullName: null,
};

function panelAuth(user = AUTHORIZED_USER) {
  return { requireUser: async () => user };
}

function fakeRepository(rows) {
  return {
    async listConversationQueue() {
      return rows;
    },
    async findConversationQueueRow(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async listRecentMessages() {
      return [{ direction: "incoming", authorType: "CUSTOMER", text: "Hola", occurredAt: NOW.toISOString() }];
    },
  };
}

const ROW = Object.freeze({
  id: "conv-1",
  platform: "whatsapp",
  participantDisplayName: "Marina Díaz",
  participantPhoneNormalized: "+5492494587046",
  status: "OPEN",
  handling: "HUMAN",
  assignedTo: null,
  leadId: "lead-1",
  leadName: "Marina Díaz",
  lastInboundAt: "2026-09-03T11:00:00.000Z",
  lastOutboundAt: null,
  lastMessageText: "Busco una Amarok automática con permuta",
  accountDisplayName: "JDA WhatsApp",
});

test("la cola cuenta cuántas esperan y cuántas están sin atender", async () => {
  const { rows, waitingCount, lateCount } = await getConversationQueue({
    repository: fakeRepository([ROW]),
    now: NOW,
    panelAuth: panelAuth(),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contactName, "Marina Díaz");
  assert.equal(rows[0].sla, "late");
  assert.equal(waitingCount, 1);
  assert.equal(lateCount, 1);
});

test("sin nombre de lead usa el nombre que trajo el canal, y sin ninguno un rótulo honesto", async () => {
  const sinLead = { ...ROW, leadId: null, leadName: null };
  const sinNada = { ...sinLead, participantDisplayName: null };
  const { rows } = await getConversationQueue({
    repository: fakeRepository([sinLead, sinNada]),
    now: NOW,
    panelAuth: panelAuth(),
  });
  assert.equal(rows[0].contactName, "Marina Díaz");
  assert.equal(rows[1].contactName, "Contacto sin nombre");
});

test("una conversación inexistente en el hilo no inventa nada", async () => {
  const { conversation, messages } = await getConversationThread("no-existe", {
    repository: fakeRepository([ROW]),
    now: NOW,
    panelAuth: panelAuth(),
  });
  assert.equal(conversation, null);
  assert.deepEqual(messages, []);
});

test("sin sesión autorizada del panel no se lee ni una fila", async () => {
  const intruso = panelAuth({ ...AUTHORIZED_USER, email: "intruso@example.com" });
  await assert.rejects(
    getConversationQueue({ repository: fakeRepository([ROW]), now: NOW, panelAuth: intruso }),
  );
});

test("el hilo trae la conversación encontrada con su SLA", async () => {
  const { conversation, messages } = await getConversationThread("conv-1", {
    repository: fakeRepository([ROW]),
    now: NOW,
    panelAuth: panelAuth(),
  });
  assert.equal(conversation.id, "conv-1");
  assert.equal(conversation.sla, "late");
  assert.equal(messages.length, 1);
});
