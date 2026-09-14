import {
  D1ChannelInboxRepository,
  type ChannelInboxRepositoryLike,
} from "@/lib/data/channel-inbox-repository";
import {
  runAdvisorTurn,
  type AdvisorContextSummary,
  type AdvisorImage,
  type AdvisorMessage,
  type AdvisorRuntime,
} from "./advisor";
import {
  sendOutboundMessage,
  windowIsOpen,
  type OutboundRuntime,
} from "./inbox-outbound";

/** Cuántos mensajes previos ve el asesor. Un chat de venta no necesita más. */
export const ADVISOR_HISTORY_LIMIT = 20;

export type AdvisorReplyOutcome = Readonly<{
  status: "replied" | "escalated" | "skipped" | "failed";
  reason: string;
}>;

export type AdvisorReplyRuntime = Readonly<{
  repository?: ChannelInboxRepositoryLike;
  outbound?: OutboundRuntime;
  advisor?: AdvisorRuntime;
  now?: Date;
}>;

type AdvisorHistoryRow = Readonly<{
  direction: string;
  text: string | null;
  attachmentsJson?: string;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Zernio entrega los adjuntos de Instagram/Facebook como enlaces CDN HTTPS.
 * Sólo exponemos imágenes, como máximo dos y sin credenciales embebidas.
 */
export function imageAttachments(attachmentsJson: string | null | undefined): AdvisorImage[] {
  if (!attachmentsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(attachmentsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const images: AdvisorImage[] = [];
  for (const raw of parsed) {
    const attachment = record(raw);
    const payload = record(attachment?.payload);
    const type = stringField(attachment, "type", "attachmentType")?.toLowerCase();
    const contentType = stringField(attachment, "contentType", "mimeType")?.toLowerCase();
    const rawUrl = stringField(attachment, "url", "imageUrl", "attachmentUrl") ??
      stringField(payload, "url", "imageUrl");
    if (!rawUrl || (type !== "image" && !contentType?.startsWith("image/"))) continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 8_192) continue;
      if (!images.some((image) => image.url === url.href)) images.push({ url: url.href });
    } catch {
      continue;
    }
    if (images.length === 2) break;
  }
  return images;
}

export function toHistory(
  rows: readonly AdvisorHistoryRow[],
  includeImages = false,
): AdvisorMessage[] {
  const history: AdvisorMessage[] = [];
  for (const row of rows) {
    const text = typeof row.text === "string" ? row.text.trim().slice(0, 4_000) : "";
    const images = includeImages ? imageAttachments(row.attachmentsJson) : [];
    if (!text && images.length === 0) continue;
    const next = {
      role: row.direction === "outgoing" ? ("assistant" as const) : ("user" as const),
      content: images.length > 0
        ? [
            { type: "text" as const, text: text || "El cliente envió una imagen sin texto." },
            ...images.map((image) => ({
              type: "image" as const,
              source: { type: "url" as const, url: image.url },
            })),
          ]
        : text,
    };
    // Zernio confirma los salientes con otro evento. Si el identificador del
    // proveedor no coincide con el de la respuesta de envío, el texto puede
    // entrar dos veces seguidas; no se lo mostramos así al modelo.
    const previous = history.at(-1);
    if (
      previous?.role === next.role &&
      JSON.stringify(previous.content) === JSON.stringify(next.content)
    ) continue;
    history.push(next);
  }
  return history;
}

const AMOUNT_TOKEN = /(\d[\d.,]*)\s*(millones?|m(?:ill[oó]n)?|mil|lucas?|luquitas?|k)?/gi;
const AMOUNT_TOKEN_SOURCE = String.raw`\d[\d.,]*\s*(?:millones?|m(?:ill[oó]n)?|mil|lucas?|luquitas?|k)?`;
const VEHICLE_BRANDS = [
  "audi", "bmw", "byd", "chery", "chevrolet", "citroen", "fiat", "ford", "honda",
  "hyundai", "jeep", "kia", "mercedes", "nissan", "peugeot", "ram", "renault",
  "toyota", "volkswagen", "volvo",
] as const;
const VEHICLE_TYPES: Readonly<Record<string, string>> = {
  auto: "auto",
  autos: "auto",
  sedan: "auto",
  sedán: "auto",
  hatchback: "auto",
  suv: "SUV",
  pickup: "pickup",
  camioneta: "SUV o pickup",
  utilitario: "utilitario",
  furgoneta: "utilitario",
};

function amountValue(raw: string, suffix?: string): number | null {
  const normalized = raw.replace(/\s/g, "");
  const numeric = Number(
    normalized.includes(",") && normalized.includes(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.includes(",")
        ? normalized.replace(",", ".")
        : normalized.replace(/\./g, ""),
  );
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const lower = (suffix ?? "").toLowerCase();
  const multiplier = lower.startsWith("mill") || lower === "m" ? 1_000_000 :
    lower === "mil" || lower.startsWith("luc") || lower === "k" ? 1_000 : 1;
  const value = Math.round(numeric * multiplier);
  return Number.isSafeInteger(value) ? value : null;
}

function parseAmountToken(token: string): number | null {
  const match = token.trim().match(/^(\d[\d.,]*)\s*(millones?|m(?:ill[oó]n)?|mil|lucas?|luquitas?|k)?$/i);
  return match ? amountValue(match[1] ?? "", match[2]) : null;
}

function amountForLabel(text: string, label: RegExp): number | null {
  const source = `(?:${label.source})`;
  // En el español de WhatsApp el importe suele ir antes ("100 lucas de
  // anticipo") o después ("anticipo: 100 lucas"). Probamos ambas formas para
  // no confundir el anticipo con la cuota que aparece en la misma oración.
  const before = new RegExp(`(${AMOUNT_TOKEN_SOURCE})\\s*(?:de\\s+)?${source}`, "i").exec(text);
  const after = new RegExp(`${source}\\s*(?:máxima|maxima|mensual)?\\s*(?:es|de|:)?\\s*(${AMOUNT_TOKEN_SOURCE})`, "i").exec(text);
  return parseAmountToken(before?.[1] ?? after?.[1] ?? "");
}

function firstAmount(text: string): number | null {
  for (const match of text.matchAll(AMOUNT_TOKEN)) {
    const value = amountValue(match[1] ?? "", match[2]);
    if (value !== null) return value;
  }
  return null;
}

function moneyLabel(value: number | null): string {
  return value === null ? "sin monto confirmado" : `$${value.toLocaleString("es-AR")} ARS`;
}

function factLine(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

/**
 * Resume sólo hechos que se pueden leer de la charla. Sirve para que el
 * modelo no dependa de interpretar una cadena larga de WhatsApp y para que
 * una respuesta evasiva no borre lo que ya estaba confirmado.
 */
export function buildAdvisorContext(
  rows: readonly { direction: string; text: string | null }[],
  currentMessage = "",
): AdvisorContextSummary {
  let quota: number | null = null;
  let downPayment: number | null = null;
  let budget: number | null = null;
  let brand: string | null = null;
  let vehicleType: string | null = null;
  let lastAmbiguous: string | null = null;
  let previousAssistant = "";

  for (const row of [...rows, { direction: "incoming", text: currentMessage }]) {
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    if (row.direction === "outgoing") {
      previousAssistant = text;
      continue;
    }
    const lower = text.toLocaleLowerCase("es-AR");
    const quotaValue = amountForLabel(text, /cuota|por\s+mes|mensual/i) ??
      (/cuota|por\s+mes|mensual/i.test(previousAssistant) ? firstAmount(text) : null);
    if (quotaValue !== null) quota = quotaValue;
    const downPaymentValue = amountForLabel(text, /anticipo|entrega/i);
    if (downPaymentValue !== null) downPayment = downPaymentValue;
    const budgetValue = amountForLabel(
      text,
      /presupuesto|plata\s+disponible|disponible\s+en\s+total|total\s+(?:disponible|tengo|sería|seria|es)/i,
    );
    if (budgetValue !== null && !/anticipo|entrega/i.test(lower)) budget = budgetValue;

    for (const candidate of VEHICLE_BRANDS) {
      if (new RegExp(`\\b${candidate}\\b`, "i").test(lower)) {
        brand = candidate === "bmw" ? "BMW" : candidate[0].toUpperCase() + candidate.slice(1);
        break;
      }
    }
    for (const [candidate, normalized] of Object.entries(VEHICLE_TYPES)) {
      if (new RegExp(`\\b${candidate}\\b`, "i").test(lower)) {
        vehicleType = normalized;
        lastAmbiguous = null;
        break;
      }
    }
    if (/\bbusco\b/.test(lower) && /\btraba\b/.test(lower)) lastAmbiguous = text;
    previousAssistant = "";
  }

  const lines = [
    factLine("Cuota máxima", moneyLabel(quota)),
    factLine("Anticipo", moneyLabel(downPayment)),
    factLine("Presupuesto total disponible", moneyLabel(budget)),
    factLine("Marca", brand ?? "no indicada"),
    factLine("Tipo de vehículo", vehicleType ?? "no indicado"),
  ];
  if (lastAmbiguous) {
    lines.push(`- Frase ambigua pendiente: «${lastAmbiguous.slice(0, 180)}»`);
    lines.push("- No asumas que «traba» es un tipo de vehículo: pedí que aclare si habla de un auto para trabajar o de otra necesidad.");
  }
  lines.push(
    "- Regla de continuidad: no vuelvas a pedir un dato que figure arriba como confirmado.",
    "- Próximo paso: preguntá una sola cosa concreta; priorizá el dato que el motor necesita para avanzar.",
  );
  return { text: lines.join("\n") };
}

/**
 * Puente entre lo que entra y lo que sale.
 *
 * Sólo contesta cuando **alguien puso esa conversación en modo asesor**: las
 * conversaciones nacen en `HUMAN`, así que por defecto no hay respuesta
 * automática. Es deliberado: ningún cliente recibe un mensaje de la IA sin que
 * el equipo lo haya habilitado para esa conversación.
 */
export async function replyIfAdvisorHandles(
  input: {
    conversationId: string;
    message: string;
    attachmentsJson?: string;
    /** Clave estable del mensaje entrante, para que un reintento no duplique el envío. */
    inboundMessageId: string;
  },
  runtime: AdvisorReplyRuntime = {},
): Promise<AdvisorReplyOutcome> {
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();

  const context = await repository.findConversationForOutbound(input.conversationId);
  if (!context) return { status: "skipped", reason: "CONVERSATION_NOT_FOUND" };
  if (!context.accountAdvisorEnabled) return { status: "skipped", reason: "CHANNEL_ADVISOR_DISABLED" };
  if (context.handling !== "AI") return { status: "skipped", reason: "HUMAN_HANDLING" };
  if (context.status === "CLOSED") return { status: "skipped", reason: "CONVERSATION_CLOSED" };
  // Fuera de la ventana sólo entra plantilla aprobada, y el asesor no manda
  // plantillas: no tiene sentido gastar un turno de modelo para no poder hablar.
  if (!windowIsOpen(context, now)) return { status: "skipped", reason: "WINDOW_CLOSED" };

  const recentRows = await repository.listRecentMessages(context.id, ADVISOR_HISTORY_LIMIT);
  const includeImages = context.platform === "instagram" || context.platform === "messenger";
  // Los CDN de Meta expiran. La imagen actual se procesa en el mismo webhook;
  // el historial conserva el texto, no reenvía enlaces vencidos al modelo.
  const history = toHistory(recentRows);
  // El mensaje que dispara el turno ya está persistido: se saca del historial
  // para no dárselo dos veces al modelo.
  const lastRow = recentRows.at(-1);
  if (
    history.length > 0 &&
    lastRow?.direction === "incoming" &&
    (lastRow.text ?? "") === input.message &&
    (lastRow.attachmentsJson ?? "[]") === (input.attachmentsJson ?? "[]")
  ) {
    history.pop();
  }
  const contextSummary = buildAdvisorContext(recentRows, input.message);
  const images = includeImages ? imageAttachments(input.attachmentsJson) : [];

  const outboundRuntime: OutboundRuntime = {
    ...runtime.outbound,
    ...(runtime.outbound?.repository ? {} : { repository }),
    ...(runtime.now ? { now } : {}),
  };

  let turn;
  try {
    turn = await runAdvisorTurn(
      { conversationId: context.id, history, message: input.message, images, contextSummary },
      {
        ...runtime.advisor,
        ...(runtime.now ? { now } : {}),
        toolContext: {
          outboundRuntime,
          idempotencyKey: `advisor:${input.inboundMessageId}`,
          ...runtime.advisor?.toolContext,
        },
      },
    );
  } catch (error) {
    // El asesor no está configurado o falló antes de arrancar: la conversación
    // se queda con una persona en lugar de quedar muda.
    console.error("advisor_reply_turn_failed", {
      reason: "ADVISOR_UNAVAILABLE",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    await repository.setHandling({
      conversationId: context.id,
      handling: "HUMAN",
      assignedTo: context.assignedTo,
      updatedAt: now.toISOString(),
    });
    return { status: "failed", reason: "ADVISOR_UNAVAILABLE" };
  }

  if (turn.reply === null) {
    console.info("advisor_reply_outcome", { status: "escalated", reason: turn.outcome });
    return { status: "escalated", reason: turn.outcome };
  }

  try {
    await sendOutboundMessage(
      {
        conversationId: context.id,
        text: turn.reply,
        author: { type: "AI", id: "asesor" },
        // Derivada del mensaje entrante: si el mismo evento se procesara dos
        // veces, el proveedor descarta el segundo envío.
        idempotencyKey: `advisor:${input.inboundMessageId}`,
      },
      outboundRuntime,
    );
  } catch {
    console.error("advisor_reply_send_failed", { status: "failed", reason: "SEND_FAILED" });
    return { status: "failed", reason: "SEND_FAILED" };
  }

  console.info("advisor_reply_outcome", {
    status: turn.escalated ? "escalated" : "replied",
    reason: turn.outcome,
  });
  return {
    status: turn.escalated ? "escalated" : "replied",
    reason: turn.outcome,
  };
}
