import {
  CHANNEL_PROVIDER_ZERNIO as ZERNIO_PROVIDER,
  D1ChannelInboxRepository,
  type ChannelInboxRepositoryLike,
  type OutboundContext,
} from "@/lib/data/channel-inbox-repository";
import {
  D1RateLimitRepository,
  type RateLimitRepositoryLike,
} from "@/lib/data/rate-limit-repository";
import { ApiError } from "./api";
import { ZernioClient, type ZernioClientLike, type ZernioTemplate } from "./zernio-client";

/** Ventana de servicio de WhatsApp: fuera de ella sólo entra plantilla. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp corta arriba de ~10 mensajes por minuto al mismo destinatario. */
export const RECIPIENT_PACE_LIMIT = 8;
export const RECIPIENT_PACE_WINDOW_MS = 60_000;

export const MAX_OUTBOUND_TEXT = 4_000;

/** Plataformas donde la ventana de 24 horas es una regla de la plataforma. */
const WINDOWED_PLATFORMS = new Set(["whatsapp", "sms"]);

export type OutboundAuthor = Readonly<{
  type: "AI" | "SELLER";
  id: string | null;
}>;

export type OutboundRuntime = Readonly<{
  repository?: ChannelInboxRepositoryLike;
  client?: ZernioClientLike;
  rateLimiter?: RateLimitRepositoryLike;
  now?: Date;
  newId?: () => string;
}>;

export type OutboundResult = Readonly<{
  externalMessageId: string;
  usedTemplate: boolean;
}>;

export function windowIsOpen(context: OutboundContext, now: Date): boolean {
  if (!WINDOWED_PLATFORMS.has(context.platform)) return true;
  if (!context.lastInboundAt) return false;
  const lastInbound = Date.parse(context.lastInboundAt);
  if (!Number.isFinite(lastInbound)) return false;
  return now.getTime() - lastInbound < CUSTOMER_SERVICE_WINDOW_MS;
}

async function pace(
  context: OutboundContext,
  runtime: OutboundRuntime,
  now: Date,
): Promise<void> {
  const repository = runtime.rateLimiter ?? new D1RateLimitRepository();
  const windowStart = Math.floor(now.getTime() / RECIPIENT_PACE_WINDOW_MS) * RECIPIENT_PACE_WINDOW_MS;
  const expiresAt = new Date(windowStart + RECIPIENT_PACE_WINDOW_MS * 2).toISOString();
  const { hits } = await repository.hit({
    key: `outbound:${context.id}:${new Date(windowStart).toISOString()}`,
    resource: "outbound.message",
    expiresAt,
  });
  if (hits > RECIPIENT_PACE_LIMIT) {
    const retryAfter = Math.ceil(
      (windowStart + RECIPIENT_PACE_WINDOW_MS - now.getTime()) / 1000,
    );
    throw new ApiError(
      429,
      "RECIPIENT_PACE_EXCEEDED",
      "Se enviaron demasiados mensajes seguidos a este contacto.",
      undefined,
      { "Retry-After": String(Math.max(retryAfter, 1)) },
    );
  }
}

/**
 * Único camino de salida de la bandeja. Vale tanto para el asesor como para
 * una respuesta escrita a mano en el panel, y hace cumplir por código lo que
 * la plataforma cobra o rechaza:
 *
 * - fuera de la ventana de 24 horas no sale texto libre, sale plantilla
 *   aprobada o no sale nada;
 * - el ritmo por destinatario se frena acá y no cuando WhatsApp devuelve
 *   `131056`;
 * - cada saliente queda en la bandeja con su autor y con la simulación de la
 *   que salieron sus cifras, así que ninguna cifra enviada es huérfana.
 */
export async function sendOutboundMessage(
  input: {
    conversationId: string;
    text: string;
    author: OutboundAuthor;
    idempotencyKey: string;
    simulationId?: string | null;
    template?: ZernioTemplate | null;
  },
  runtime: OutboundRuntime = {},
): Promise<OutboundResult> {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_OUTBOUND_TEXT) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      text: "El mensaje está vacío o es demasiado largo.",
    });
  }

  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();
  const newId = runtime.newId ?? (() => crypto.randomUUID());

  const context = await repository.findConversationForOutbound(input.conversationId);
  if (!context) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "No encontramos la conversación.");
  }
  if (context.accountStatus !== "ACTIVE") {
    throw new ApiError(
      409,
      "CHANNEL_ACCOUNT_INACTIVE",
      "La cuenta de mensajería no está activa.",
    );
  }

  const open = windowIsOpen(context, now);
  if (!open && !input.template) {
    throw new ApiError(
      409,
      "TEMPLATE_REQUIRED",
      "Pasaron más de 24 horas desde el último mensaje del cliente: hace falta una plantilla aprobada.",
    );
  }

  await pace(context, runtime, now);

  const client = runtime.client ?? new ZernioClient();
  const usedTemplate = !open;
  const sent = usedTemplate
    ? await client.startWithTemplate({
        externalAccountId: context.externalAccountId,
        participantId: context.participantExternalId,
        template: input.template as ZernioTemplate,
        idempotencyKey: input.idempotencyKey,
      })
    : await client.sendText({
        externalConversationId: context.externalConversationId,
        externalAccountId: context.externalAccountId,
        text,
        idempotencyKey: input.idempotencyKey,
      });

  await repository.recordOutboundMessage({
    id: newId(),
    conversationId: context.id,
    provider: ZERNIO_PROVIDER,
    externalConversationId: context.externalConversationId,
    externalMessageId: sent.externalMessageId,
    platformMessageId: null,
    authorType: input.author.type,
    authorId: input.author.id,
    text,
    simulationId: input.simulationId ?? null,
    leadEventId: context.leadId ? newId() : null,
    occurredAt: now.toISOString(),
  });

  return { externalMessageId: sent.externalMessageId, usedTemplate };
}

/**
 * Escalada al vendedor. No manda nada al cliente: mueve la conversación a
 * atención humana con el hilo entero disponible y deja el motivo asentado en
 * la línea de tiempo del lead. El asesor deja de escribir desde ese momento.
 */
export async function escalateToHuman(
  input: { conversationId: string; reason: string; assignTo?: string | null },
  runtime: OutboundRuntime = {},
): Promise<void> {
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();
  const context = await repository.findConversationForOutbound(input.conversationId);
  if (!context) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "No encontramos la conversación.");
  }
  const newId = runtime.newId ?? (() => crypto.randomUUID());
  await repository.setHandling({
    conversationId: context.id,
    handling: "HUMAN",
    assignedTo: input.assignTo ?? null,
    updatedAt: now.toISOString(),
  });
  await repository.recordConversationEvent({
    id: newId(),
    conversationId: context.id,
    type: "INBOX_ESCALATED",
    actorType: "SYSTEM",
    actorId: input.assignTo ?? context.assignedTo,
    metadataJson: JSON.stringify({ reason: input.reason.slice(0, 120) }),
    occurredAt: now.toISOString(),
  });
}

/**
 * Pasa la conversación al asesor. Requiere que la ventana esté abierta: sin
 * ventana el asesor no podría responder y quedaría un cliente esperando a un
 * bot que no puede hablar.
 */
export async function handOverToAdvisor(
  input: { conversationId: string },
  runtime: OutboundRuntime = {},
): Promise<void> {
  const repository = runtime.repository ?? new D1ChannelInboxRepository();
  const now = runtime.now ?? new Date();
  const context = await repository.findConversationForOutbound(input.conversationId);
  if (!context) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "No encontramos la conversación.");
  }
  if (!windowIsOpen(context, now)) {
    throw new ApiError(
      409,
      "WINDOW_CLOSED",
      "La ventana de conversación está cerrada: el asesor no puede responder.",
    );
  }
  await repository.setHandling({
    conversationId: context.id,
    handling: "AI",
    assignedTo: null,
    updatedAt: now.toISOString(),
  });
}
