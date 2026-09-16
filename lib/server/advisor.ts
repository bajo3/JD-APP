import { ApiError } from "./api";
import {
  ADVISOR_TOOLS,
  createAdvisorSession,
  runAdvisorTool,
  type AdvisorSession,
  type AdvisorToolContext,
} from "./advisor-tools";
import { MAX_OUTBOUND_TEXT } from "./inbox-outbound";
import { advisorIsConfigured, configuredAdvisorProvider } from "./advisor-config";

export const ADVISOR_MODEL = "claude-opus-5";
export const OPENAI_ADVISOR_MODEL = "gpt-5.4-mini";

/**
 * Tope de rondas de herramientas por turno. Un asesor que necesita más de
 * cuatro consultas para contestar un mensaje de WhatsApp no está resolviendo:
 * está dando vueltas, y una persona lo hace mejor.
 */
export const MAX_TOOL_ROUNDS = 4;

/**
 * Reglas que el asesor no puede negociar. Lo que se puede hacer cumplir por
 * código está en `advisor-tools.ts`; acá está lo que además tiene que decir y
 * cómo se tiene que comportar.
 */
export const ADVISOR_SYSTEM_PROMPT = `Sos el asesor de Jesús Díaz Automotores, una agencia de autos de Tandil, y atendés por WhatsApp, Instagram o Messenger.

Cómo hablás:
- Español rioplatense, de vos, natural y breve. Estás en un chat, no escribiendo un folleto.
- Primero entendés qué quiso decir y respondés a eso. No convertís cada mensaje
  en un formulario ni intentás cerrar una venta a la fuerza.
- Podés ser cálido, usar humor leve y seguir una charla informal. Nunca sonás
  como un menú, un call center o una plantilla repetida.
- Mensajes cortos. Una idea por mensaje. Nada de listas largas ni de mayúsculas para gritar.
- No usás menús numerados ni pedís que elijan opciones: conversás.
- No repetís un dato que el cliente ya confirmó. Lo reconocés y seguís desde ahí.
- Si faltan varios datos, preguntás sólo uno por vez y elegís el próximo que
  hace falta para avanzar; nunca mandás una lista de tres preguntas.
- No pedís presupuesto, anticipo o cuota hasta que realmente hagan falta para
  responder lo que la persona está buscando. Una pregunta general merece una
  respuesta general antes de empezar a calificar el lead.
- Si el cliente nombra una marca o modelo y pregunta si está disponible, usás
  consultar_stock_publicado inmediatamente. Primero respondés qué hay en el
  stock real; no preguntás si lo quiere usado o cero, presupuesto ni cuota.
- Si hay coincidencias, mostrás primero marca, modelo, versión, año,
  kilometraje, transmisión y precio cuando esté vigente. También compartís la
  foto principal y la ficha que devuelve la herramienta. Después, y sólo si el
  cliente pregunta por financiación, averiguás anticipo y cuota.
- Si no hay coincidencias, decís directo que hoy no aparece publicado. No
  respondés «puede ser», «sí, puede haber» ni lo matás a preguntas; ofrecés
  buscarle una alternativa parecida.
- Si el cliente cambia de tema, hace un chiste o corrige algo, acompañás el
  contexto y no repetís mecánicamente la última pregunta.
- Si recibís una transcripción de audio, la tratás como lo que dijo el cliente;
  no le mencionás procesos internos ni que fue transcripta.
- Interpretás expresiones coloquiales como "40 lucas" o "100 luquitas" como
  montos en pesos, pero no inventás un total cuando la persona dice "depende"
  o "lo menos posible".
- Si un mensaje tiene un error o una frase ambigua, lo decís con naturalidad y
  pedís una aclaración concreta. No lo convertís a la fuerza en auto, SUV,
  pickup, marca o presupuesto.
- Si el cliente manda una foto, observás sólo lo visible. Podés describir o
  reconocer una marca o modelo probable, pero nunca afirmás año, versión,
  kilometraje, disponibilidad ni precio sólo por la imagen.
- Cuando pregunten "precio?" sobre una foto o publicación, o "¿tenés X?" por
  una marca o modelo escrito, usás consultar_stock_publicado con esas pistas.
  Si hay una única
  coincidencia clara, respondés con esa unidad y aclarás "si te referís a este";
  si hay varias o ninguna, pedís una sola aclaración concreta.

Qué averiguás, sin interrogar (preguntá de a una y sólo lo que falte):
- cuánta plata tiene disponible en total;
- cuánto puede poner de anticipo;
- qué cuota mensual máxima puede pagar;
- qué busca: modelo, segmento o para qué lo va a usar;
- si necesita financiación;
- si entrega un vehículo como parte de pago;
- para cuándo quiere comprar.

Reglas que no se rompen nunca:
- No inventás stock, precios, cuotas, tasas, plazos, bonificaciones ni condiciones comerciales. Ni una cifra sale de tu cabeza.
- Toda unidad que menciones tiene que venir de buscar_vehiculos o consultar_stock_publicado. Si no vino de una de esas herramientas, no existe para vos.
- Toda cuota tiene que venir de simular_operacion y va acompañada del código de la operación. Un precio publicado también puede venir de consultar_stock_publicado.
- Para buscar qué puede pagar necesitás presupuesto, anticipo y cuota máxima. Si falta alguno, preguntalo; no lo supongas. Una consulta puntual de precio sobre una publicación usa consultar_stock_publicado y no exige esos tres datos.
- Buscar por modelo o disponibilidad no es buscar financiación: nunca exijas
  presupuesto, anticipo o cuota para consultar_stock_publicado.
- Si una unidad vuelve con disponibilidad "consultar", no le pongas precio ni cuota: decí que hay que confirmar disponibilidad.
- Si la respuesta trae avisos de que el tarifario es DEMO o ilustrativo, decilo con todas las letras: son cifras de ejemplo, no una oferta.
- Nunca prometés reservar, entregar, bonificar ni sostener un precio. Eso lo confirma una persona.
- No prometés tiempos de respuesta ni horarios que no te dieron.
- Si no sabés algo, no completás con lo que suena razonable: escalás.
- Si el cliente entrega un usado, primero registrás los datos con registrar_permuta. Sólo podés usar cotizar_permuta para devolver el rango preliminar que salga del tarifario vigente; nunca calculás una cifra ni prometés una toma.
- Para una visita usás solicitar_visita sólo con fecha, hora y zona horaria. La solicitud no agenda: una persona confirma disponibilidad y horario.

Cuándo escalás con escalar_a_persona:
- el cliente quiere reservar, señar, cerrar o pide una excepción comercial;
- pide hablar con una persona;
- reclama, está enojado o el tema es delicado;
- te pide algo que no podés verificar con las herramientas.

Después de escalar, avisale que lo sigue una persona del equipo y no sigas negociando.`;

export type AdvisorImage = Readonly<{
  url: string;
}>;

export type AdvisorContentBlock =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "image"; source: Readonly<{ type: "url"; url: string }> }>;

export type AdvisorMessage = Readonly<{
  role: "user" | "assistant";
  content: string | readonly AdvisorContentBlock[];
}>;

export type AdvisorModelClient = {
  createMessage(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<AdvisorModelResponse>;
};

export type AdvisorModelResponse = Readonly<{
  stop_reason?: string | null;
  content: readonly Record<string, unknown>[];
}>;

export type AdvisorRuntime = Readonly<{
  model?: AdvisorModelClient;
  toolContext?: Partial<AdvisorToolContext>;
  session?: AdvisorSession;
  provider?: "openai" | "anthropic";
  openAiApiKey?: string;
  anthropicApiKey?: string;
  fetchImpl?: typeof fetch;
  /** @deprecated Compatibilidad con pruebas e integraciones anteriores de Anthropic. */
  apiKey?: string;
  now?: Date;
}>;

export type AdvisorTurn = Readonly<{
  /** Texto para el cliente. `null` cuando no hay nada seguro que decir. */
  reply: string | null;
  /** La conversación quedó en manos de una persona. */
  escalated: boolean;
  /** Por qué terminó el turno; sirve para el panel y para las pruebas. */
  outcome:
    | "replied"
    | "escalated"
    | "escalated_no_reply"
    | "escalated_tool_budget"
    | "escalated_model_error"
    | "escalated_refusal";
  toolCalls: readonly Readonly<{ name: string; ok: boolean; code?: string }>[];
  vehicleCards: readonly AdvisorVehicleCard[];
}>;

export type AdvisorVehicleCard = Readonly<{
  vehicleId: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  mileageKm: number | null;
  transmission: string | null;
  fuelType: string | null;
  color: string | null;
  availability: "confirmada" | "consultar";
  price: number | null;
  currency: string | null;
  detailUrl: string;
  photos: readonly string[];
}>;

export type AdvisorContextSummary = Readonly<{
  /** Hechos extraídos de los mensajes del cliente; nunca son cálculos comerciales. */
  text: string;
}>;

/**
 * El SDK se carga sólo cuando hace falta hablar con el modelo. Una
 * conversación atendida por una persona no arrastra la librería al bundle del
 * Worker ni al arranque del pedido.
 */
export function anthropicClient(apiKey?: string): AdvisorModelClient {
  const key = (apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!advisorIsConfigured(key)) {
    throw new ApiError(
      503,
      "ADVISOR_NOT_CONFIGURED",
      "El asesor no está configurado.",
    );
  }
  return {
    async createMessage(params, options) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: key });
      return (await client.messages.create(
        params as unknown as Parameters<typeof client.messages.create>[0],
        options,
      )) as unknown as AdvisorModelResponse;
    },
  };
}

function systemText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n\n");
}

function openAIInput(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const input: Record<string, unknown>[] = [];
  for (const rawMessage of value) {
    if (!rawMessage || typeof rawMessage !== "object") continue;
    const message = rawMessage as Record<string, unknown>;
    const role = message.role === "assistant" ? "assistant" : "user";
    if (typeof message.content === "string") {
      input.push({ role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    const modelContent: Record<string, unknown>[] = [];
    for (const rawBlock of message.content) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const block = rawBlock as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        modelContent.push({ type: "input_text", text: block.text });
      } else if (block.type === "image") {
        const source = block.source;
        const url = source && typeof source === "object" && !Array.isArray(source)
          ? (source as Record<string, unknown>).url
          : null;
        if (typeof url === "string") {
          modelContent.push({ type: "input_image", image_url: url, detail: "auto" });
        }
      }
    }
    if (modelContent.length > 0) input.push({ role, content: modelContent });
    for (const rawBlock of message.content) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const block = rawBlock as Record<string, unknown>;
      if (block.type === "tool_use") {
        input.push({
          type: "function_call",
          call_id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          arguments: JSON.stringify(block.input ?? {}),
        });
      } else if (block.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: String(block.tool_use_id ?? ""),
          output: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? {}),
        });
      }
    }
  }
  return input;
}

/**
 * Responses exige que una herramienta strict tenga todos los campos del
 * objeto en `required`. Los campos que en nuestro contrato son opcionales se
 * expresan como nullable y el modelo los devuelve como `null` cuando no
 * aplican. Anthropic usa el mismo schema sin esta restricción adicional.
 */
function openAIStrictSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const schema = value as Record<string, unknown>;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    if (schema.items) return { ...schema, items: openAIStrictSchema(schema.items) };
    return { ...schema };
  }

  const propertyEntries = Object.entries(properties as Record<string, unknown>);
  const originalRequired = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const normalizedProperties: Record<string, unknown> = {};
  for (const [key, property] of propertyEntries) {
    const normalized = openAIStrictSchema(property);
    if (originalRequired.has(key)) {
      normalizedProperties[key] = normalized;
      continue;
    }
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
      normalizedProperties[key] = normalized;
      continue;
    }
    const nullable = { ...(normalized as Record<string, unknown>) };
    const type = nullable.type;
    if (typeof type === "string") {
      nullable.type = [type, "null"];
    } else if (Array.isArray(type) && !type.includes("null")) {
      nullable.type = [...type, "null"];
    }
    normalizedProperties[key] = nullable;
  }
  return {
    ...schema,
    properties: normalizedProperties,
    required: propertyEntries.map(([key]) => key),
  };
}

function openAITools(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawTool) => {
    if (!rawTool || typeof rawTool !== "object") return [];
    const tool = rawTool as Record<string, unknown>;
    const strict = tool.strict === true;
    return [{
      type: "function",
      name: String(tool.name ?? ""),
      description: String(tool.description ?? ""),
      parameters: strict ? openAIStrictSchema(tool.input_schema ?? {}) : (tool.input_schema ?? {}),
      strict,
    }];
  });
}

function safeArguments(value: unknown): unknown {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Adapta Responses API al contrato interno que también usa Anthropic. */
export function openAIClient(apiKey?: string, fetchImpl: typeof fetch = fetch): AdvisorModelClient {
  const key = (apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (!advisorIsConfigured(key)) {
    throw new ApiError(503, "ADVISOR_NOT_CONFIGURED", "El asesor no está configurado.");
  }
  return {
    async createMessage(params, options) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_ADVISOR_MODEL?.trim() || OPENAI_ADVISOR_MODEL,
          instructions: systemText(params.system),
          input: openAIInput(params.messages),
          tools: openAITools(params.tools),
          tool_choice: "auto",
          // Chat corto y herramientas estrictas: sin razonamiento persistible
          // evitamos estado opaco entre rondas y reducimos latencia/costo.
          reasoning: { effort: "none" },
          max_output_tokens: 1_200,
          store: false,
        }),
        signal: options?.signal,
      });
      if (!response.ok) {
        let errorCode: string | null = null;
        let errorType: string | null = null;
        try {
          const errorPayload = await response.clone().json() as Record<string, unknown>;
          const error = errorPayload.error;
          if (error && typeof error === "object" && !Array.isArray(error)) {
            const record = error as Record<string, unknown>;
            errorCode = typeof record.code === "string" ? record.code.slice(0, 80) : null;
            errorType = typeof record.type === "string" ? record.type.slice(0, 80) : null;
          }
        } catch {
          // La respuesta de error puede no ser JSON; el status alcanza para
          // diagnosticarla sin guardar el cuerpo (que podría traer datos).
        }
        console.error("advisor_openai_request_failed", {
          status: response.status,
          errorCode,
          errorType,
        });
        throw new Error(`OpenAI respondió ${response.status}.`);
      }
      const payload = await response.json() as Record<string, unknown>;
      if (payload.status !== "completed" || !Array.isArray(payload.output)) {
        console.error("advisor_openai_incomplete", {
          responseStatus: typeof payload.status === "string" ? payload.status : null,
          outputArray: Array.isArray(payload.output),
        });
        throw new Error("OpenAI no completó la respuesta.");
      }
      let refused = false;
      const content: Record<string, unknown>[] = [];
      for (const rawItem of payload.output) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const item = rawItem as Record<string, unknown>;
        if (item.type === "function_call") {
          content.push({
            type: "tool_use",
            id: String(item.call_id ?? item.id ?? ""),
            name: String(item.name ?? ""),
            input: safeArguments(item.arguments),
          });
        }
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const rawPart of item.content) {
            if (!rawPart || typeof rawPart !== "object") continue;
            const part = rawPart as Record<string, unknown>;
            if (part.type === "output_text" && typeof part.text === "string") {
              content.push({ type: "text", text: part.text });
            }
            if (part.type === "refusal") refused = true;
          }
        }
      }
      return { stop_reason: refused ? "refusal" : "end_turn", content };
    },
  };
}

function defaultModel(runtime: AdvisorRuntime): AdvisorModelClient {
  if (runtime.provider === "openai") return openAIClient(runtime.openAiApiKey, runtime.fetchImpl);
  if (runtime.provider === "anthropic") {
    return anthropicClient(runtime.anthropicApiKey ?? runtime.apiKey);
  }
  // `apiKey` era el único override histórico y sigue representando Anthropic.
  if (runtime.apiKey !== undefined) return anthropicClient(runtime.apiKey);
  const provider = configuredAdvisorProvider();
  if (provider === "openai") return openAIClient(runtime.openAiApiKey, runtime.fetchImpl);
  return anthropicClient(runtime.anthropicApiKey);
}

function textOf(content: readonly Record<string, unknown>[]): string {
  const parts: string[] = [];
  let previous: string | null = null;
  for (const block of content) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    const text = String(block.text).trim();
    if (text.length === 0 || text === previous) continue;
    parts.push(text);
    previous = text;
  }
  return parts
    .join("\n\n")
    .slice(0, MAX_OUTBOUND_TEXT);
}

function toolUses(
  content: readonly Record<string, unknown>[],
): Array<{ id: string; name: string; input: unknown }> {
  return content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: String(block.id ?? ""),
      name: String(block.name ?? ""),
      input: block.input,
    }));
}

function optionalCardText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function vehicleCardsFromTool(result: Awaited<ReturnType<typeof runAdvisorTool>>): AdvisorVehicleCard[] {
  if (!result.ok || !Array.isArray(result.data.coincidencias)) return [];
  return result.data.coincidencias.flatMap((raw): AdvisorVehicleCard[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const vehicleId = optionalCardText(item.vehicleId);
    const make = optionalCardText(item.marca);
    const model = optionalCardText(item.modelo);
    const detailUrl = optionalCardText(item.ficha);
    const year = item.anio;
    if (!vehicleId || !make || !model || !detailUrl || !Number.isSafeInteger(year)) return [];
    const photos = Array.isArray(item.fotos)
      ? item.fotos.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3)
      : [];
    return [{
      vehicleId,
      make,
      model,
      trim: optionalCardText(item.version),
      year: year as number,
      mileageKm: Number.isSafeInteger(item.kilometrajeKm) ? item.kilometrajeKm as number : null,
      transmission: optionalCardText(item.transmision),
      fuelType: optionalCardText(item.combustible),
      color: optionalCardText(item.color),
      availability: item.disponibilidad === "confirmada" ? "confirmada" : "consultar",
      price: typeof item.precioPublicado === "number" && Number.isFinite(item.precioPublicado)
        ? item.precioPublicado
        : null,
      currency: optionalCardText(item.moneda),
      detailUrl,
      photos,
    }];
  });
}

/**
 * Un turno del asesor. Devuelve el texto que habría que mandarle al cliente,
 * pero **no lo manda**: el envío pasa por `sendOutboundMessage`, que es el que
 * hace cumplir la ventana de 24 horas y el ritmo por destinatario.
 *
 * Falla cerrado por diseño. Ante error del modelo, respuesta vacía, rechazo
 * del modelo o demasiadas rondas de herramientas, escala a una persona en
 * lugar de improvisar una respuesta para no dejar al cliente esperando.
 */
export async function runAdvisorTurn(
  input: {
    conversationId: string;
    history: readonly AdvisorMessage[];
    message: string;
    images?: readonly AdvisorImage[];
    contextSummary?: AdvisorContextSummary | string;
  },
  runtime: AdvisorRuntime = {},
): Promise<AdvisorTurn> {
  const session = runtime.session ?? createAdvisorSession();
  const context: AdvisorToolContext = {
    conversationId: input.conversationId,
    session,
    ...(runtime.now ? { now: runtime.now } : {}),
    ...runtime.toolContext,
  };
  const toolCalls: Array<{ name: string; ok: boolean; code?: string }> = [];
  const vehicleCards: AdvisorVehicleCard[] = [];
  const currentContent: string | AdvisorContentBlock[] = input.images && input.images.length > 0
    ? [
        { type: "text", text: input.message || "El cliente envió una imagen sin texto." },
        ...input.images.slice(0, 2).map((image): AdvisorContentBlock => ({
          type: "image",
          source: { type: "url", url: image.url },
        })),
      ]
    : input.message;
  const messages: Array<Record<string, unknown>> = [
    ...input.history.map((entry) => ({ role: entry.role, content: entry.content })),
    { role: "user", content: currentContent },
  ];

  const escalate = async (
    outcome: AdvisorTurn["outcome"],
    reason: string,
  ): Promise<AdvisorTurn> => {
    const result = await runAdvisorTool("escalar_a_persona", { motivo: reason }, context);
    toolCalls.push({
      name: "escalar_a_persona",
      ok: result.ok,
      ...(result.ok ? {} : { code: result.code }),
    });
    return { reply: null, escalated: true, outcome, toolCalls, vehicleCards };
  };

  const model = runtime.model ?? defaultModel(runtime);

  const systemBlocks: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: ADVISOR_SYSTEM_PROMPT,
      // El prompt base y las herramientas son estables: se cachean para que
      // cada mensaje del cliente no vuelva a pagarlos.
      cache_control: { type: "ephemeral" },
    },
  ];
  const contextSummary =
    typeof input.contextSummary === "string"
      ? input.contextSummary.trim()
      : input.contextSummary?.text.trim() ?? "";
  if (contextSummary) {
    systemBlocks.push({
      type: "text",
      text: `MEMORIA FACTUAL DE ESTA CONVERSACIÓN:\n${contextSummary}`,
    });
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    let response: AdvisorModelResponse;
    try {
      response = await model.createMessage({
        model: ADVISOR_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        // Una charla de WhatsApp no necesita el esfuerzo máximo; la exactitud
        // no depende del modelo sino de las herramientas.
        output_config: { effort: "medium" },
        system: systemBlocks,
        tools: ADVISOR_TOOLS,
        messages,
      });
    } catch {
      return escalate("escalated_model_error", "FALLO_DEL_ASESOR");
    }

    if (response.stop_reason === "refusal") {
      return escalate("escalated_refusal", "EL_ASESOR_NO_PUEDE_RESPONDER");
    }

    const uses = toolUses(response.content);
    if (uses.length === 0) {
      const reply = textOf(response.content);
      if (reply.length === 0) {
        return escalate("escalated_no_reply", "EL_ASESOR_NO_TIENE_RESPUESTA");
      }
      return { reply, escalated: false, outcome: "replied", toolCalls, vehicleCards };
    }

    if (round === MAX_TOOL_ROUNDS) {
      return escalate("escalated_tool_budget", "DEMASIADAS_CONSULTAS_SIN_RESPUESTA");
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Array<Record<string, unknown>> = [];
    let escalated = false;
    let terminalReply: string | null = null;
    for (const use of uses) {
      const result = await runAdvisorTool(use.name, use.input, context);
      if (use.name === "consultar_stock_publicado") {
        for (const card of vehicleCardsFromTool(result)) {
          if (!vehicleCards.some((current) => current.vehicleId === card.vehicleId)) vehicleCards.push(card);
        }
      }
      toolCalls.push({
        name: use.name,
        ok: result.ok,
        ...(result.ok ? {} : { code: result.code }),
      });
      if (use.name === "escalar_a_persona" && result.ok) escalated = true;
      if (use.name === "solicitar_visita" && result.ok) {
        escalated = true;
        const message = result.data.mensajeCliente;
        terminalReply = typeof message === "string" ? message : null;
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        ...(result.ok ? {} : { is_error: true }),
        content: JSON.stringify(result.ok ? result.data : { error: result.code, message: result.message }),
      });
    }
    // Todos los resultados vuelven en un único mensaje: partirlos le enseña al
    // modelo a dejar de pedir herramientas en paralelo.
    messages.push({ role: "user", content: results });

    if (escalated) {
      return {
        reply: terminalReply ?? "Te sigue una persona del equipo por acá mismo.",
        escalated: true,
        outcome: "escalated",
        toolCalls,
        vehicleCards,
      };
    }
  }

  return escalate("escalated_tool_budget", "DEMASIADAS_CONSULTAS_SIN_RESPUESTA");
}
