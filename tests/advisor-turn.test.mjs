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
    // El reescrito a .ts vale sólo para el código del proyecto: dentro de
    // node_modules los imports relativos ya resuelven solos.
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

const {
  ADVISOR_MODEL,
  ADVISOR_SYSTEM_PROMPT,
  MAX_TOOL_ROUNDS,
  runAdvisorTurn,
} = await import("../lib/server/advisor.ts");

const NOW = new Date("2026-09-03T12:00:00.000Z");

function escalationRuntime(calls = []) {
  return {
    now: NOW,
    newId: () => "id-1",
    repository: {
      async findConversationForOutbound(id) {
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
        calls.push(["motivo", JSON.parse(input.metadataJson).reason]);
      },
    },
  };
}

function scriptedModel(turns) {
  const seen = [];
  let index = 0;
  return {
    seen,
    client: {
      async createMessage(params) {
        seen.push(params);
        const turn = turns[Math.min(index, turns.length - 1)];
        index += 1;
        if (typeof turn === "function") return turn(params);
        return turn;
      },
    },
  };
}

function turn(model, overrides = {}) {
  return runAdvisorTurn(
    {
      conversationId: "conv-local",
      history: [],
      message: "Tengo una Suran 2013 y quiero algo automático para la familia",
      ...overrides,
    },
    {
      model,
      now: NOW,
      toolContext: {
        outboundRuntime: escalationRuntime(overrides.calls ?? []),
        ...(overrides.toolContext ?? {}),
      },
    },
  );
}

test("el asesor contesta con el texto del modelo cuando no necesita herramientas", async () => {
  const { client, seen } = scriptedModel([
    { stop_reason: "end_turn", content: [{ type: "text", text: "Contame de cuánto disponés" }] },
  ]);
  const result = await turn(client);
  assert.equal(result.outcome, "replied");
  assert.equal(result.escalated, false);
  assert.equal(result.reply, "Contame de cuánto disponés");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].model, ADVISOR_MODEL);
  assert.equal(seen[0].thinking.type, "adaptive");
  assert.equal(seen[0].system[0].cache_control.type, "ephemeral");
  assert.equal(seen[0].tools.length, 7);
});

test("una respuesta vacía escala en lugar de improvisar", async () => {
  const calls = [];
  const { client } = scriptedModel([{ stop_reason: "end_turn", content: [] }]);
  const result = await turn(client, { calls });
  assert.equal(result.outcome, "escalated_no_reply");
  assert.equal(result.escalated, true);
  assert.equal(result.reply, null, "no se le manda nada al cliente");
  assert.deepEqual(calls, [["handling", "HUMAN"], ["motivo", "EL_ASESOR_NO_TIENE_RESPUESTA"]]);
});

test("si el modelo falla, escala; nunca contesta de memoria", async () => {
  const calls = [];
  const client = {
    async createMessage() {
      throw new Error("timeout");
    },
  };
  const result = await turn(client, { calls });
  assert.equal(result.outcome, "escalated_model_error");
  assert.equal(result.reply, null);
  assert.deepEqual(calls, [["handling", "HUMAN"], ["motivo", "FALLO_DEL_ASESOR"]]);
});

test("un rechazo del modelo también termina en una persona", async () => {
  const calls = [];
  const { client } = scriptedModel([{ stop_reason: "refusal", content: [] }]);
  const result = await turn(client, { calls });
  assert.equal(result.outcome, "escalated_refusal");
  assert.equal(result.escalated, true);
});

test("las herramientas se ejecutan y sus resultados vuelven en un único mensaje", async () => {
  const { client, seen } = scriptedModel([
    {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "buscar_vehiculos",
          input: { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000 },
        },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Te paso lo que entra" }] },
  ]);
  const result = await turn(client);
  assert.equal(result.outcome, "replied");
  assert.equal(result.reply, "Te paso lo que entra");
  assert.deepEqual(
    result.toolCalls.map((call) => call.name),
    ["buscar_vehiculos"],
  );

  const second = seen[1];
  const toolResults = second.messages.filter(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.every((block) => block.type === "tool_result"),
  );
  assert.equal(toolResults.length, 1, "un solo mensaje con todos los tool_result");
  assert.equal(toolResults[0].content.length, 1);
  assert.equal(toolResults[0].content[0].tool_use_id, "tu-1");
});

test("una herramienta rechazada vuelve marcada como error y el asesor sigue sin inventar", async () => {
  const { client, seen } = scriptedModel([
    {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "simular_operacion",
          input: { vehicleId: "x", vehicleSlug: "x", selectionVersion: "y" },
        },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Necesito buscar primero" }] },
  ]);
  const result = await turn(client);
  assert.equal(result.toolCalls[0].ok, false);
  assert.equal(result.toolCalls[0].code, "SELECTION_NOT_FROM_SEARCH");
  const block = seen[1].messages.at(-1).content[0];
  assert.equal(block.is_error, true);
  assert.match(block.content, /SELECTION_NOT_FROM_SEARCH/);
});

test("cuando el asesor escala, el turno termina ahí y no negocia más", async () => {
  const calls = [];
  const { client, seen } = scriptedModel([
    {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "escalar_a_persona",
          input: { motivo: "quiere señar la unidad" },
        },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "te hago precio" }] },
  ]);
  const result = await turn(client, { calls });
  assert.equal(result.outcome, "escalated");
  assert.equal(result.escalated, true);
  assert.equal(seen.length, 1, "no se le vuelve a preguntar al modelo");
  assert.doesNotMatch(result.reply, /precio|reserv|seña/i);
  assert.deepEqual(calls, [["handling", "HUMAN"], ["motivo", "quiere señar la unidad"]]);
});

test("una solicitud de visita queda pendiente y termina el turno del asesor", async () => {
  const { client, seen } = scriptedModel([
    {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu-visit",
          name: "solicitar_visita",
          input: { fechaHoraSolicitada: "2026-09-05T12:00:00.000Z", vehicleId: null },
        },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "El turno quedó confirmado" }] },
  ]);
  const result = await turn(client, {
    toolContext: {
      visitRepository: { async createRequest() { return true; } },
    },
  });
  assert.equal(result.outcome, "escalated");
  assert.equal(result.escalated, true);
  assert.equal(seen.length, 1, "no puede confirmar un turno después de solicitarlo");
  assert.match(result.reply, /persona del equipo.*confirmar/i);
});

test("el asesor no puede dar vueltas para siempre pidiendo herramientas", async () => {
  const calls = [];
  const { client, seen } = scriptedModel([
    () => ({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: `tu-${Math.random()}`,
          name: "buscar_vehiculos",
          input: { presupuestoTotal: 8_000_000, anticipo: 2_000_000, cuotaMaxima: 900_000 },
        },
      ],
    }),
  ]);
  const result = await turn(client, { calls });
  assert.equal(result.outcome, "escalated_tool_budget");
  assert.equal(result.reply, null);
  assert.equal(seen.length, MAX_TOOL_ROUNDS + 1);
  assert.deepEqual(calls, [["handling", "HUMAN"], ["motivo", "DEMASIADAS_CONSULTAS_SIN_RESPUESTA"]]);
});

test("el prompt le prohíbe explícitamente inventar y le exige escalar", () => {
  assert.match(ADVISOR_SYSTEM_PROMPT, /No inventás stock, precios, cuotas/);
  assert.match(ADVISOR_SYSTEM_PROMPT, /tiene que venir de buscar_vehiculos/);
  assert.match(ADVISOR_SYSTEM_PROMPT, /tiene que venir de simular_operacion/);
  assert.match(ADVISOR_SYSTEM_PROMPT, /DEMO/);
  assert.match(ADVISOR_SYSTEM_PROMPT, /Nunca prometés reservar/);
  assert.match(ADVISOR_SYSTEM_PROMPT, /escalar_a_persona/);
  assert.equal(ADVISOR_MODEL, "claude-opus-5");
});
