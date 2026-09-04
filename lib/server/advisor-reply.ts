import {
  D1ChannelInboxRepository,
  type ChannelInboxRepositoryLike,
} from "@/lib/data/channel-inbox-repository";
import { runAdvisorTurn, type AdvisorMessage, type AdvisorRuntime } from "./advisor";
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

function toHistory(
  rows: readonly { direction: string; text: string | null }[],
): AdvisorMessage[] {
  return rows
    .filter((row) => typeof row.text === "string" && row.text.trim().length > 0)
    .map((row) => ({
      role: row.direction === "outgoing" ? ("assistant" as const) : ("user" as const),
      content: String(row.text).slice(0, 4_000),
    }));
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
    /** Clave estable del mensaje entrante, para que un reintento no duplique el envío. */
    inboundMessageId: string;
  },
  runtime: AdvisorReplyRuntime = {},
): Promise<AdvisorReplyOutcome> {
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();

  const context = await repository.findConversationForOutbound(input.conversationId);
  if (!context) return { status: "skipped", reason: "CONVERSATION_NOT_FOUND" };
  if (context.handling !== "AI") return { status: "skipped", reason: "HUMAN_HANDLING" };
  if (context.status === "CLOSED") return { status: "skipped", reason: "CONVERSATION_CLOSED" };
  // Fuera de la ventana sólo entra plantilla aprobada, y el asesor no manda
  // plantillas: no tiene sentido gastar un turno de modelo para no poder hablar.
  if (!windowIsOpen(context, now)) return { status: "skipped", reason: "WINDOW_CLOSED" };

  const history = toHistory(
    await repository.listRecentMessages(context.id, ADVISOR_HISTORY_LIMIT),
  );
  // El mensaje que dispara el turno ya está persistido: se saca del historial
  // para no dárselo dos veces al modelo.
  if (history.length > 0 && history[history.length - 1]?.content === input.message) {
    history.pop();
  }

  const outboundRuntime: OutboundRuntime = {
    ...runtime.outbound,
    ...(runtime.outbound?.repository ? {} : { repository }),
    ...(runtime.now ? { now } : {}),
  };

  let turn;
  try {
    turn = await runAdvisorTurn(
      { conversationId: context.id, history, message: input.message },
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
  } catch {
    // El asesor no está configurado o falló antes de arrancar: la conversación
    // se queda con una persona en lugar de quedar muda.
    return { status: "failed", reason: "ADVISOR_UNAVAILABLE" };
  }

  if (turn.reply === null) {
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
    return { status: "failed", reason: "SEND_FAILED" };
  }

  return {
    status: turn.escalated ? "escalated" : "replied",
    reason: turn.outcome,
  };
}
