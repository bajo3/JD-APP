import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("conversaciones entra en la navegación del panel", async () => {
  const navigation = await read("app/panel/_components/PanelNavigation.tsx");
  assert.match(navigation, /\["\/panel\/conversaciones", "Conversaciones"/);
  assert.match(navigation, /\["\/panel\/configuracion", "Configuración"/);
  assert.match(navigation, /aria-current=\{active \? "page"/);
});

test("la cola exige sesión del panel antes de leer nada", async () => {
  const data = await read("lib/server/inbox-panel-data.ts");
  const guardQueue = data.indexOf("await requirePanelUser(undefined, runtime.panelAuth);");
  const query = data.indexOf("repository.listConversationQueue()");
  assert.ok(guardQueue >= 0, "sin guard no se sirve la cola");
  assert.ok(query >= 0, "la cola consulta el repositorio");
  assert.ok(guardQueue < query, "el guard corre antes de tocar la base");
});

test("la pantalla de la cola no manda mensajes: sólo enlaza al detalle", async () => {
  const source = await read("app/panel/conversaciones/page.tsx");
  assert.doesNotMatch(source, /fetch\(|onClick/);
  assert.match(source, /href={`\/panel\/conversaciones\/\$\{row\.id\}`}/);
});

test("la respuesta manual pasa por el circuito de salida con clave de idempotencia estable", async () => {
  const source = await read("app/panel/_components/ConversationReplyForm.tsx");
  assert.match(source, /idempotencyKey\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(source, /"Idempotency-Key": idempotencyKey\.current/);
  assert.match(source, /idempotencyKey\.current = null/);
  assert.match(source, /\/reply`/);
});

test("escalar a persona pide el motivo antes de mandarlo", async () => {
  const source = await read("app/panel/_components/ConversationReplyForm.tsx");
  assert.match(source, /window\.prompt/);
  assert.match(source, /if \(!reason\.trim\(\)\) return;/);
});

test("las rutas de mutación exigen sesión de administrador antes de tocar la base", async () => {
  const source = await read("lib/server/admin-handlers.ts");
  const reply = source.indexOf("export function adminConversationReply");
  const replyGuard = source.indexOf("adminApiRoute(request", reply);
  const replyBody = source.indexOf("sendOutboundMessage(", reply);
  assert.ok(replyGuard >= 0 && replyGuard < replyBody, "reply corre adminApiRoute antes de mandar");

  const handling = source.indexOf("export function adminConversationHandling");
  const handlingGuard = source.indexOf("adminApiRoute(request", handling);
  const handlingBody = source.indexOf("escalateToHuman(", handling);
  assert.ok(handlingGuard >= 0 && handlingGuard < handlingBody, "handling corre adminApiRoute antes de escalar");

  const workflow = source.indexOf("export function adminConversationWorkflow");
  const workflowGuard = source.indexOf("adminApiRoute(request", workflow);
  const workflowBody = source.indexOf("updateConversationWorkflow(", workflow);
  assert.ok(workflowGuard >= 0 && workflowGuard < workflowBody, "workflow corre adminApiRoute antes de escribir");
});

test("la cola permite autoasignarse sin anidar el botón dentro del enlace", async () => {
  const page = await read("app/panel/conversaciones/page.tsx");
  const button = await read("app/panel/_components/ConversationAssignButton.tsx");
  assert.match(page, /ConversationAssignButton/);
  assert.match(page, /!row\.assignedTo/);
  assert.match(button, /action: "assign-self"/);
  assert.match(button, /aria-label={`Asignarme esta conversación: \$\{contactName\}`}/);
  assert.match(button, /role="status"/);
  assert.ok(page.indexOf("</Link>") < page.indexOf("<ConversationAssignButton"));
});

test("el detalle programa recordatorios internos y exige motivo de pérdida", async () => {
  const page = await read("app/panel/conversaciones/[id]/page.tsx");
  const form = await read("app/panel/_components/ConversationWorkflowForm.tsx");
  assert.match(page, /ConversationWorkflowForm/);
  assert.match(form, /schedule-follow-up/);
  assert.match(form, /clear-follow-up/);
  assert.match(form, /mark-lost/);
  assert.match(form, /recordatorio interno; no envía mensajes automáticamente/);
  assert.match(form, /name="reason" required minLength=\{2\} maxLength=\{500\}/);
});

test("responder exige Idempotency-Key antes de leer el texto", async () => {
  const source = await read("lib/server/admin-handlers.ts");
  const reply = source.indexOf("export function adminConversationReply");
  const idempotency = source.indexOf("requireIdempotencyKey(request)", reply);
  const text = source.indexOf('requiredString(payload, "text"', reply);
  assert.ok(idempotency >= 0 && idempotency < text);
});

test("Zernio vive en Configuración y Conversaciones carga solamente la cola", async () => {
  const conversations = await read("app/panel/conversaciones/page.tsx");
  const settings = await read("app/panel/configuracion/page.tsx");
  assert.doesNotMatch(conversations, /ChannelAccountForm|getChannelAccounts/);
  assert.match(conversations, /href="\/panel\/configuracion"/);
  assert.match(settings, /ChannelAccountForm/);
  assert.match(settings, /ChannelAdvisorControls/);
  assert.match(settings, /OpenAI listo/);
  assert.match(conversations, /PanelAuthenticationRequired/);
  assert.match(conversations, /PanelAccessError/);
});

test("el agente tiene interruptor por canal y permanece apagado por defecto", async () => {
  const controls = await read("app/panel/_components/ChannelAdvisorControls.tsx");
  const schema = await read("db/schema.ts");
  const reply = await read("lib/server/advisor-reply.ts");
  assert.match(controls, /method: "PATCH"/);
  assert.match(controls, /expectedVersion: account\.version/);
  assert.match(schema, /advisorEnabled: boolean\("advisor_enabled"\)\.notNull\(\)\.default\(false\)/);
  assert.match(reply, /CHANNEL_ADVISOR_DISABLED/);
});

test("el panel evita listados innecesarios y muestra carga durante la navegación", async () => {
  const data = await read("lib/server/admin-panel-data.ts");
  const dashboard = data.slice(
    data.indexOf("export async function getAdminDashboardData"),
    data.indexOf("type PanelResource"),
  );
  assert.doesNotMatch(dashboard, /listAdminLeads|listAdminStock|listAdminAppraisals|listAdminConsignments|listAdminPromotions|listFinanceVersions/);
  assert.match(await read("app/panel/conversaciones/loading.tsx"), /Cargando conversaciones/);
  assert.match(await read("app/panel/configuracion/loading.tsx"), /Cargando configuración/);
});

test("el panel guía la conexión Zernio sin pedir claves ni IDs manuales", async () => {
  const source = await read("app/panel/_components/ChannelAccountForm.tsx");
  for (const platform of ["whatsapp", "instagram", "facebook"]) {
    assert.match(source, new RegExp(`value: "${platform}"`));
  }
  assert.match(source, /idempotencyKeys\.current\[action\] \?\?= crypto\.randomUUID\(\)/);
  assert.match(source, /\/api\/v1\/admin\/zernio/);
  assert.match(source, /\/api\/v1\/admin\/zernio\/connect/);
  assert.match(source, /\/api\/v1\/admin\/zernio\/sync/);
  assert.match(source, /\/api\/v1\/admin\/zernio\/webhook/);
  assert.doesNotMatch(source, /name="(?:apiKey|webhookSecret|externalAccountId|accountId)"/);
  assert.doesNotMatch(source, /channel-accounts/);
});

test("el gestor conserva estado, OAuth server-side, callback seguro y reintento", async () => {
  const source = await read("app/panel/_components/ChannelAccountForm.tsx");
  assert.match(source, /fetch\("\/api\/v1\/admin\/zernio", \{ cache: "no-store" \}\)/);
  assert.match(source, /window\.location\.searchParams|get\("zernio"\)/);
  assert.match(source, /marker === "callback"/);
  assert.match(source, /marker === "cancelled"/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /sessionStorage\.setItem\("jda:zernio-profile"/);
  assert.match(source, /sessionStorage\.getItem\("jda:zernio-profile"/);
  assert.match(source, /window\.location\.assign\(parsedUrl\.href\)/);
  assert.match(source, /role="status"/);
  assert.match(source, /Reintentar/);
  assert.match(source, /profileId: selectedProfileId/);
  assert.match(source, /accountIds: selectedAccountIds/);
  assert.match(source, /action: "ensure"|configureWebhook\("ensure"\)/);
  assert.match(source, /action: "test"|configureWebhook\("test"\)/);
});

test("la ruta de cuentas exige sesión antes de crear o listar", async () => {
  const source = await read("lib/server/admin-handlers.ts");
  const start = source.indexOf("export function adminChannelAccounts");
  const guard = source.indexOf("adminApiRoute(request", start);
  const create = source.indexOf("createChannelAccount(", start);
  assert.ok(guard >= 0 && guard < create, "el guard corre antes del alta");
});
