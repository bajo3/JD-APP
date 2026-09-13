import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = Object.freeze({});", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return { url: pathToFileURL(resolve(projectRoot, specifier === "@/db" ? "db/index.ts" : specifier === "@/lib/admin" ? "lib/admin/index.ts" : relative.endsWith(".mjs") ? relative : `${relative}.ts`)).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return { format: "module", source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceMap: false }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { adminZernioStatus, adminZernioConnect, adminZernioSync, adminZernioWebhook } = await import("../lib/server/zernio-admin.ts");
const { ZernioClient } = await import("../lib/server/zernio-client.ts");

const previousEmails = process.env.PANEL_ALLOWED_EMAILS;
const previousIds = process.env.PANEL_ALLOWED_ACCOUNT_IDS;
process.env.PANEL_ALLOWED_EMAILS = "vendedor@jda.test";
process.env.PANEL_ALLOWED_ACCOUNT_IDS = "seller-1";
test.after(() => {
  if (previousEmails === undefined) delete process.env.PANEL_ALLOWED_EMAILS; else process.env.PANEL_ALLOWED_EMAILS = previousEmails;
  if (previousIds === undefined) delete process.env.PANEL_ALLOWED_ACCOUNT_IDS; else process.env.PANEL_ALLOWED_ACCOUNT_IDS = previousIds;
});

const auth = { async readSession() { return { id: "seller-1", email: "vendedor@jda.test", name: "Vendedor", status: "ACTIVE" }; } };
const profiles = [{ id: "profile-1", name: "JDA", isDefault: true }];
const accounts = [
  { id: "wa-1", profileId: "profile-1", platform: "whatsapp", username: "+549249", displayName: "JDA WhatsApp", connected: true },
  { id: "fb-1", profileId: "profile-1", platform: "facebook", username: "jda", displayName: "JDA Facebook", connected: false },
];

function client(overrides = {}) {
  return {
    async listProfiles() { return profiles; },
    async listAccounts() { return accounts; },
    async getAccountsHealth() { return [
      { id: "wa-1", status: "healthy", needsReconnect: false },
      { id: "fb-1", status: "error", needsReconnect: true },
    ]; },
    async getConnectUrl() { return "https://www.facebook.com/oauth"; },
    async listWebhooks() { return []; },
    async createWebhook(input) { return { id: "hook-1", name: input.name, url: input.url, events: input.events, isActive: true, failureCount: 0, lastFiredAt: null }; },
    async updateWebhook(input) { return { id: input.id, name: input.name, url: input.url, events: input.events, isActive: true, failureCount: 0, lastFiredAt: null }; },
    async testWebhook() {},
    ...overrides,
  };
}

function repository(overrides = {}) {
  return {
    async listChannelAccounts() { return []; },
    async syncChannelAccounts(input) { return { ok: true, replayed: false, synced: input.accounts.length }; },
    async findIntegrationAction() { return null; },
    async recordIntegrationAction() { return "created"; },
    ...overrides,
  };
}

test("el estado autoriza antes de llamar a Zernio", async () => {
  let called = false;
  const response = await adminZernioStatus(new Request("http://local/api/v1/admin/zernio"), {
    auth: { async readSession() { return null; } },
    apiKey: "sk_una-clave-configurada",
    client: client({ async listProfiles() { called = true; return profiles; } }),
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("el estado no expone secretos y mapea Facebook a Messenger", async () => {
  const response = await adminZernioStatus(new Request("http://local/api/v1/admin/zernio"), {
    auth, client: client(), repository: repository(), apiKey: "sk_secreto_que_no_debe_salir", webhookSecret: "otro-secreto-privado", siteUrl: "https://jd.example",
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /sk_secreto|otro-secreto-privado/);
  const payload = JSON.parse(text).data;
  assert.equal(payload.state, "READY");
  assert.equal(payload.remoteAccounts[1].localPlatform, "messenger");
  assert.equal(payload.webhookUrl, "https://jd.example/api/v1/webhooks/zernio");
});

test("OAuth revalida el perfil y sólo devuelve una URL HTTPS del proveedor", async () => {
  let seen;
  const response = await adminZernioConnect(new Request("http://local/api/v1/admin/zernio/connect?platform=whatsapp&profileId=profile-1"), {
    auth, client: client({ async getConnectUrl(input) { seen = input; return "https://zernio.com/connect/ok"; } }), apiKey: "sk_clave_configurada", siteUrl: "https://jd.example",
  });
  assert.equal(response.status, 200);
  assert.equal(seen.redirectUrl, "https://jd.example/panel/conversaciones?zernio=callback");
});

test("sync ignora datos inventados por el cliente y usa la cuenta verificada", async () => {
  let persisted;
  const response = await adminZernioSync(new Request("http://local/api/v1/admin/zernio/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "sync-key-1" },
    body: JSON.stringify({ profileId: "profile-1", accountIds: ["fb-1"] }),
  }), {
    auth, client: client(), apiKey: "sk_clave_configurada", repository: repository({ async syncChannelAccounts(input) { persisted = input; return { ok: true, replayed: false, synced: 1 }; } }),
  });
  assert.equal(response.status, 200);
  assert.equal(persisted.accounts[0].platform, "messenger");
  assert.equal(persisted.accounts[0].displayName, "JDA Facebook");
  assert.equal(persisted.accounts[0].status, "PAUSED");
});

test("sync rechaza un accountId ajeno al perfil sin escribir", async () => {
  let writes = 0;
  const response = await adminZernioSync(new Request("http://local/api/v1/admin/zernio/sync", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "sync-key-2" }, body: JSON.stringify({ profileId: "profile-1", accountIds: ["inventada"] }),
  }), { auth, client: client(), apiKey: "sk_clave_configurada", repository: repository({ async syncChannelAccounts() { writes += 1; return { ok: true }; } }) });
  assert.equal(response.status, 422);
  assert.equal(writes, 0);
});

test("ensure crea el webhook fijo y test reutiliza el webhook existente", async () => {
  let created;
  const store = repository();
  const ensure = await adminZernioWebhook(new Request("http://local/api/v1/admin/zernio/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "hook-ensure" }, body: JSON.stringify({ action: "ensure" }),
  }), { auth, client: client({ async createWebhook(input) { created = input; return { id: "hook-1", name: input.name, url: input.url, events: input.events, isActive: true, failureCount: 0, lastFiredAt: null }; } }), repository: store, apiKey: "sk_clave_configurada", webhookSecret: "secreto-webhook-configurado", siteUrl: "https://jd.example" });
  assert.equal(ensure.status, 200);
  assert.equal(created.url, "https://jd.example/api/v1/webhooks/zernio");
  assert.equal(created.secret, "secreto-webhook-configurado");

  let tested = false;
  const existing = { id: "hook-1", name: "JDA CRM", url: created.url, events: created.events, isActive: true, failureCount: 0, lastFiredAt: null };
  const checked = await adminZernioWebhook(new Request("http://local/api/v1/admin/zernio/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "hook-test" }, body: JSON.stringify({ action: "test" }),
  }), { auth, client: client({ async listWebhooks() { return [existing]; }, async testWebhook() { tested = true; } }), repository: store, apiKey: "sk_clave_configurada", webhookSecret: "secreto-webhook-configurado", siteUrl: "https://jd.example" });
  assert.equal(checked.status, 200);
  assert.equal(tested, true);
});

test("el cliente de gestión valida y sanea perfiles, cuentas y salud", async () => {
  const requests = [];
  const responses = new Map([
    ["/v1/profiles", { profiles: [{ _id: "profile-1", name: "JDA", isDefault: true }] }],
    ["/v1/accounts", { accounts: [{ _id: "wa-1", platform: "whatsapp", profileId: { _id: "profile-1" }, username: "+549", displayName: "JDA", isActive: true }] }],
    ["/v1/accounts/health", { accounts: [{ accountId: "wa-1", status: "healthy", needsReconnect: false }] }],
  ]);
  const instance = new ZernioClient({ apiKey: "sk_clave_configurada", fetchImpl: async (url, init) => {
    requests.push(init);
    const path = new URL(url).pathname.replace(/^\/api/, "");
    return Response.json(responses.get(path));
  } });
  assert.deepEqual(await instance.listProfiles(), profiles);
  assert.equal((await instance.listAccounts())[0].profileId, "profile-1");
  assert.deepEqual(await instance.getAccountsHealth(), [{ id: "wa-1", status: "healthy", needsReconnect: false }]);
  assert.equal(requests.every((init) => init.redirect === "error" && init.cache === "no-store"), true);
});

test("el cliente de gestión traduce credenciales inválidas sin devolver el cuerpo remoto", async () => {
  const instance = new ZernioClient({ apiKey: "sk_clave_configurada", fetchImpl: async () => Response.json({ error: "token super secreto" }, { status: 401 }) });
  await assert.rejects(() => instance.listProfiles(), (error) => error.code === "ZERNIO_INVALID_CREDENTIALS" && !error.message.includes("token super secreto"));
});
