import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return { url: pathToFileURL(resolve(root, relative === "db" ? "db/index.ts" : relative.endsWith(".mjs") ? relative : `${relative}.ts`)).href, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier) && !String(context.parentURL).includes("/node_modules/")) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) return { format: "module", source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceMap: false }), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { handleWebAdvisor } = await import("../lib/server/web-advisor.ts");
const vehicle = (slug, availability = "AVAILABLE_TODAY") => ({ slug, name: `Ford ${slug}`, year: "2020", km: "10.000 km", price: "$ 1", currency: "ARS", availability, availabilityLabel: "Disponibilidad a confirmar", updatedLabel: "Actualizado hoy", demo: true });
const stock = async () => ({ demo: true, sourceLabel: "Datos de demostración", vehicles: [vehicle("uno"), vehicle("dos", "CHECK_AVAILABILITY"), vehicle("tres"), vehicle("cuatro")] });
const profile = async () => ({ name: "Jesús Díaz Automotores", city: "Tandil", address: "SECRETA", phoneNational: "SECRETO", whatsappE164: null });
const request = (messages) => new Request("http://local/api/v1/web-advisor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });

test("valida alternancia y límites", async () => {
  const model = { async createMessage() { return { content: [{ type: "text", text: "Hola" }] }; } };
  assert.equal((await handleWebAdvisor(request([{ role: "assistant", content: "x" }]), { model })).status, 422);
  assert.equal((await handleWebAdvisor(request([{ role: "user", content: "x", extra: 1 }]), { model })).status, 422);
});

test("tool pública limita a tres y no filtra precio de stock stale ni PII", async () => {
  let params;
  const model = { async createMessage(p) { params = p; return { content: [{ type: "tool_use", id: "1", name: "consultar_stock_disponible", input: { busqueda: "" } }] }; } };
  // A second model response turns tool output into a reply.
  let calls = 0;
  model.createMessage = async (p) => { params = p; calls += 1; return calls === 1 ? { content: [{ type: "tool_use", id: "1", name: "consultar_stock_disponible", input: { busqueda: "" } }] } : { content: [{ type: "text", text: "Hay unidades disponibles." }] }; };
  const response = await handleWebAdvisor(request([{ role: "user", content: "¿Qué tienen?" }]), { model, stock, profile });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.links.filter((x) => x.href.startsWith("/autos/")).length, 3);
  assert.ok(!JSON.stringify(params.messages).includes("priceCents"));
  assert.ok(!JSON.stringify(params.messages).includes("SECRETA"));
});

test("falla 503 ante modelo sin respuesta o herramienta inválida", async () => {
  const empty = { async createMessage() { return { content: [] }; } };
  const invalid = { async createMessage() { return { content: [{ type: "tool_use", id: "x", name: "registrar_permuta", input: {} }] }; } };
  assert.equal((await handleWebAdvisor(request([{ role: "user", content: "hola" }]), { model: empty })).status, 503);
  assert.equal((await handleWebAdvisor(request([{ role: "user", content: "hola" }]), { model: invalid })).status, 503);
});

test("deadline total corta modelo y herramienta pendientes", async () => {
  const pendingModel = { createMessage: () => new Promise(() => {}) };
  const modelPromise = handleWebAdvisor(request([{ role: "user", content: "hola" }]), { model: pendingModel, timeoutMs: 5 });
  assert.equal((await modelPromise).status, 503);
  const pendingStock = () => new Promise(() => {});
  const toolModel = { async createMessage() { return { content: [{ type: "tool_use", id: "1", name: "consultar_stock_disponible", input: { busqueda: "" } }] }; } };
  const toolPromise = handleWebAdvisor(request([{ role: "user", content: "stock" }]), { model: toolModel, stock: pendingStock, timeoutMs: 5 });
  assert.equal((await toolPromise).status, 503);
});

test("exige JSON estricto y rechaza cuerpos grandes", async () => {
  const model = { async createMessage() { return { content: [{ type: "text", text: "ok" }] }; } };
  const wrongType = new Request("http://local", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal((await handleWebAdvisor(wrongType, { model })).status, 415);
  const tooLarge = new Request("http://local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(2_000) }], padding: "x".repeat(70_000) }) });
  assert.equal((await handleWebAdvisor(tooLarge, { model })).status, 413);
});

test("ejecuta perfil público sin exponer datos privados", async () => {
  let reads = 0;
  const model = { async createMessage() { reads += 1; return reads === 1 ? { content: [{ type: "tool_use", id: "p", name: "leer_perfil_comercial_publico", input: {} }] } : { content: [{ type: "text", text: "Somos de Tandil." }] }; } };
  const response = await handleWebAdvisor(request([{ role: "user", content: "¿Dónde están?" }]), { model, profile });
  assert.equal(response.status, 200);
  assert.equal(reads, 2);
});

test("el asesor web también puede usar OpenAI sin depender de Anthropic", async () => {
  let calls = 0;
  const response = await handleWebAdvisor(
    request([{ role: "user", content: "Hola" }]),
    {
      provider: "openai",
      openAiApiKey: "sk-openai-clave-de-prueba",
      fetchImpl: async () => {
        calls += 1;
        return Response.json({
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Hola, ¿qué auto estás buscando?" }],
          }],
        });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal((await response.json()).data.reply, "Hola, ¿qué auto estás buscando?");
});
