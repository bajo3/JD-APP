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

const { ADVISOR_TOOLS, MAX_RECOMMENDATIONS, createAdvisorSession, runAdvisorTool } = await import(
  "../lib/server/advisor-tools.ts"
);

const NOW = new Date("2026-09-03T12:00:00.000Z");

function context(overrides = {}) {
  return { conversationId: "conv-local", now: NOW, session: createAdvisorSession(), ...overrides };
}

test("las definiciones no dejan al modelo inventar argumentos", () => {
  assert.equal(ADVISOR_TOOLS.length, 5);
  const names = ADVISOR_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "buscar_vehiculos",
    "confirmar_demanda",
    "escalar_a_persona",
    "registrar_demanda",
    "simular_operacion",
  ]);
  for (const tool of ADVISOR_TOOLS) {
    assert.equal(tool.strict, true, `${tool.name} tiene que ser strict`);
    assert.equal(
      tool.input_schema.additionalProperties,
      false,
      `${tool.name} no puede aceptar campos extra`,
    );
    assert.ok(
      Array.isArray(tool.input_schema.required) && tool.input_schema.required.length > 0,
      `${tool.name} tiene que exigir algún campo`,
    );
    assert.ok(tool.description.length > 40, `${tool.name} necesita una descripción útil`);
  }
});

test("la búsqueda nunca devuelve más de tres unidades", async () => {
  const result = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000, plazos: [12, 24, 36] },
    context(),
  );
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data.opciones));
  assert.ok(result.data.opciones.length <= MAX_RECOMMENDATIONS);
  assert.equal(MAX_RECOMMENDATIONS, 3);
  assert.ok(result.data.totalEvaluadas >= result.data.opciones.length);
});

test("cada opción llega con lo necesario para simular y con su disponibilidad", async () => {
  const result = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000, plazos: [] },
    context(),
  );
  assert.equal(result.ok, true);
  for (const opcion of result.data.opciones) {
    assert.equal(typeof opcion.vehicleId, "string");
    assert.equal(typeof opcion.vehicleSlug, "string");
    assert.equal(typeof opcion.selectionVersion, "string");
    assert.ok(["confirmada", "consultar"].includes(opcion.disponibilidad));
    assert.ok(typeof opcion.estado === "string" && opcion.estado.length > 0);
    if (opcion.disponibilidad === "consultar") {
      // Dato de stock vencido: no se ofrece precio ni cuota, se ofrece consultar.
      assert.equal(opcion.precio, null);
      assert.equal(opcion.cuotaEstimada, null);
    }
  }
});

test("sin plata suficiente el motor rechaza con motivos, no con una cuota inventada", async () => {
  const result = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 0, anticipo: 0, cuotaMaxima: 1000, plazos: [12] },
    context(),
  );
  assert.equal(result.ok, true);
  for (const opcion of result.data.opciones) {
    assert.notEqual(opcion.estado, "eligible");
    assert.ok(Array.isArray(opcion.motivos));
  }
});

test("la búsqueda arrastra los avisos del tarifario en lugar de esconderlos", async () => {
  const result = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000 },
    context(),
  );
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data.avisos));
  assert.ok(typeof result.data.fuente === "string");
});

test("no se puede simular sin haber buscado antes", async () => {
  const result = await runAdvisorTool(
    "simular_operacion",
    { vehicleId: "no-existe", vehicleSlug: "no-existe", selectionVersion: "inventado" },
    context({ idempotencyKey: "advisor-test-1" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "SELECTION_NOT_FROM_SEARCH");
  assert.ok(!("data" in result), "un rechazo no puede traer importes");
});

test("no se puede simular una unidad que la búsqueda no ofreció", async () => {
  const ctx = context({ idempotencyKey: "advisor-test-2" });
  const search = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000 },
    ctx,
  );
  assert.equal(search.ok, true);
  const otra = await runAdvisorTool(
    "simular_operacion",
    { vehicleId: "otra-unidad", vehicleSlug: "otra-unidad", selectionVersion: "f".repeat(64) },
    ctx,
  );
  assert.equal(otra.ok, false);
  assert.equal(otra.code, "SELECTION_NOT_FROM_SEARCH");
});

test("tampoco se puede cambiar la selección de una unidad que sí ofreció", async () => {
  const ctx = context({ idempotencyKey: "advisor-test-3" });
  const search = await runAdvisorTool(
    "buscar_vehiculos",
    { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000 },
    ctx,
  );
  assert.equal(search.ok, true);
  const [primera] = search.data.opciones;
  if (!primera) return;
  const alterada = await runAdvisorTool(
    "simular_operacion",
    {
      vehicleId: primera.vehicleId,
      vehicleSlug: primera.vehicleSlug,
      selectionVersion: "a".repeat(64),
    },
    ctx,
  );
  assert.equal(alterada.ok, false);
  assert.equal(alterada.code, "SELECTION_NOT_FROM_SEARCH");
});

test("la escalada usa el circuito de salida y no promete plazos", async () => {
  const calls = [];
  const result = await runAdvisorTool(
    "escalar_a_persona",
    { motivo: "quiere reservar la unidad" },
    context({
      outboundRuntime: {
        now: NOW,
        newId: () => "id-1",
        repository: {
          async findConversationForOutbound(id) {
            calls.push(["find", id]);
            return {
              id,
              provider: "ZERNIO",
              externalConversationId: "conv-1",
              platform: "whatsapp",
              participantExternalId: "5492494587046",
              lastInboundAt: NOW.toISOString(),
              handling: "AI",
              assignedTo: "vendedor@jda.test",
              leadId: "lead-1",
              status: "OPEN",
              channelAccountId: "acc",
              externalAccountId: "zernio-acc",
              accountStatus: "ACTIVE",
            };
          },
          async setHandling(input) {
            calls.push(["handling", input.handling]);
          },
          async recordConversationEvent(input) {
            calls.push(["event", JSON.parse(input.metadataJson).reason]);
          },
        },
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.escalado, true);
  assert.deepEqual(calls, [
    ["find", "conv-local"],
    ["handling", "HUMAN"],
    ["event", "quiere reservar la unidad"],
  ]);
  assert.doesNotMatch(result.data.instruccion, /minutos|horas|enseguida/i);
});

test("una herramienta que no existe no se ejecuta ni se inventa", async () => {
  const result = await runAdvisorTool("descontar_precio", { porcentaje: 10 }, context());
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_TOOL");
});
