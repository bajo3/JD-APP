import {
  CHANNEL_PROVIDER_ZERNIO,
  D1ChannelInboxRepository,
  type ChannelAccountRecord,
  type ChannelInboxRepositoryLike,
} from "@/lib/data/channel-inbox-repository";
import { replyIfAdvisorHandles, type AdvisorReplyRuntime } from "./advisor-reply";
import { ApiError, apiErrorResponse, json } from "./api";

export const ZERNIO_PROVIDER = CHANNEL_PROVIDER_ZERNIO;

/** Tope del cuerpo del webhook. Un evento de bandeja son unos pocos KB. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

const DELIVERY_EVENTS: Readonly<Record<string, string>> = {
  "message.delivered": "DELIVERED",
  "message.read": "READ",
  "message.failed": "FAILED",
};

export type ZernioWebhookRuntime = Readonly<{
  repository?: ChannelInboxRepositoryLike;
  secret?: string;
  now?: Date;
  newId?: () => string;
  /** Runtime del asesor; se inyecta en las pruebas para no llamar al modelo. */
  advisorReply?: AdvisorReplyRuntime;
}>;

type Outcome = "processed" | "replayed" | "ignored";

/**
 * Comparación en tiempo constante sobre la representación hexadecimal. Sale
 * temprano sólo por longitud distinta, que no es secreto.
 */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readObject(source: unknown, key: string): Record<string, unknown> | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = (source as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Teléfono del participante de WhatsApp o SMS. En Instagram, Facebook y
 * Telegram el participante es un identificador de plataforma, no un teléfono,
 * y no se inventa uno.
 */
export function participantPhone(platform: string, participantId: string): string | null {
  if (platform !== "whatsapp" && platform !== "sms") return null;
  const digits = participantId.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function leadSource(platform: string): string {
  return `INBOX_${platform.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function leadName(participantName: string | null, platform: string): string {
  const candidate = participantName?.slice(0, 120).trim();
  if (candidate && candidate.length >= 2) return candidate;
  return `Contacto de ${platform}`;
}

function jsonAttachments(message: Record<string, unknown>): string {
  const attachments = message.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return "[]";
  try {
    return JSON.stringify(attachments).slice(0, 16 * 1024);
  } catch {
    return "[]";
  }
}

function outcomeResponse(outcome: Outcome, status: number, reason?: string): Response {
  return json(
    { data: { outcome, ...(reason ? { reason } : {}) } },
    { status },
  );
}

/**
 * Ingesta del puente Zernio.
 *
 * No pasa por el limitador por IP a propósito: el proveedor entrega desde un
 * puñado de direcciones, así que un tope por IP castigaría una ráfaga legítima
 * de eventos y perdería mensajes reales. Lo que autoriza acá es la firma, y
 * sin secreto configurado no entra nada.
 */
export async function handleZernioWebhook(
  request: Request,
  runtime: ZernioWebhookRuntime = {},
): Promise<Response> {
  try {
    const secret = (runtime.secret ?? process.env.ZERNIO_WEBHOOK_SECRET ?? "").trim();
    if (secret.length < 16) {
      throw new ApiError(
        503,
        "WEBHOOK_NOT_CONFIGURED",
        "El puente de mensajería no está configurado.",
      );
    }

    const declaredLength = request.headers.get("Content-Length");
    if (declaredLength !== null && Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "El evento es demasiado grande.");
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BODY_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "El evento es demasiado grande.");
    }

    const provided =
      request.headers.get("X-Zernio-Signature")?.trim() ??
      request.headers.get("X-Late-Signature")?.trim() ??
      "";
    const expected = await hmacSha256Hex(secret, rawBody);
    // Firma ausente y firma incorrecta responden exactamente igual: desde
    // afuera no se puede distinguir un endpoint sin firmar de uno mal firmado.
    if (!equalsConstantTime(provided.toLowerCase(), expected)) {
      throw new ApiError(401, "INVALID_SIGNATURE", "La firma del evento no es válida.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ApiError(400, "INVALID_PAYLOAD", "El evento no es JSON válido.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError(400, "INVALID_PAYLOAD", "El evento no es un objeto.");
    }

    const externalEventId = readString(payload, "id");
    const type = readString(payload, "event");
    if (!externalEventId || !type) {
      throw new ApiError(400, "INVALID_PAYLOAD", "El evento no trae identificador ni tipo.");
    }

    const repository = runtime.repository ?? new D1ChannelInboxRepository();
    const newId = runtime.newId ?? (() => crypto.randomUUID());
    const now = runtime.now ?? new Date();
    const nowIso = now.toISOString();

    const claimed = await repository.claimEvent({
      id: newId(),
      provider: ZERNIO_PROVIDER,
      externalEventId,
      type,
      payloadHash: await sha256Hex(rawBody),
      payloadJson: rawBody,
      receivedAt: nowIso,
    });
    // Un reintento del proveedor sobre un evento ya aceptado no vuelve a
    // escribir: la bandeja no duplica mensajes ni leads.
    if (!claimed) return outcomeResponse("replayed", 200);

    try {
      return await route({
        payload: payload as Record<string, unknown>,
        type,
        externalEventId,
        repository,
        newId,
        nowIso,
        now,
        ...(runtime.advisorReply ? { advisorReply: runtime.advisorReply } : {}),
      });
    } catch (error) {
      await repository.markEvent({
        provider: ZERNIO_PROVIDER,
        externalEventId,
        status: "FAILED",
        failureReason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        processedAt: nowIso,
      });
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function route(input: {
  payload: Record<string, unknown>;
  type: string;
  externalEventId: string;
  repository: ChannelInboxRepositoryLike;
  newId: () => string;
  nowIso: string;
  now: Date;
  advisorReply?: AdvisorReplyRuntime;
}): Promise<Response> {
  const { payload, type, externalEventId, repository, newId, nowIso } = input;

  const deliveryStatus = DELIVERY_EVENTS[type];
  if (deliveryStatus) {
    const message = readObject(payload, "message");
    const messageId = message ? readString(message, "id") : null;
    if (!messageId) return ignore(repository, externalEventId, nowIso, "MESSAGE_ID_MISSING");
    const errorObject = readObject(payload, "error");
    const updated = await repository.updateDeliveryStatus({
      provider: ZERNIO_PROVIDER,
      externalMessageId: messageId,
      deliveryStatus,
      deliveryError: errorObject ? JSON.stringify(errorObject).slice(0, 500) : null,
    });
    if (!updated) return ignore(repository, externalEventId, nowIso, "MESSAGE_NOT_IN_INBOX");
    await repository.markEvent({
      provider: ZERNIO_PROVIDER,
      externalEventId,
      status: "PROCESSED",
      failureReason: null,
      processedAt: nowIso,
    });
    return outcomeResponse("processed", 200);
  }

  if (type !== "message.received" && type !== "message.sent" && type !== "conversation.started") {
    return ignore(repository, externalEventId, nowIso, "EVENT_NOT_HANDLED");
  }

  const account = readObject(payload, "account");
  const conversation = readObject(payload, "conversation");
  const externalAccountId = account
    ? (readString(account, "accountId") ?? readString(account, "id"))
    : null;
  const externalConversationId = conversation ? readString(conversation, "id") : null;
  const participantExternalId = conversation ? readString(conversation, "participantId") : null;
  if (!externalAccountId || !externalConversationId || !participantExternalId) {
    return ignore(repository, externalEventId, nowIso, "CONVERSATION_CONTEXT_MISSING");
  }

  const channelAccount: ChannelAccountRecord | null = await repository.findAccount(
    ZERNIO_PROVIDER,
    externalAccountId,
  );
  // Una cuenta que nadie dio de alta en el panel no enruta a ningún vendedor.
  // El evento queda guardado y visible como no enrutado, nunca descartado.
  if (!channelAccount) return ignore(repository, externalEventId, nowIso, "UNKNOWN_ACCOUNT");
  if (channelAccount.status !== "ACTIVE") {
    return ignore(repository, externalEventId, nowIso, "ACCOUNT_INACTIVE");
  }

  const platform =
    (account ? readString(account, "platform") : null) ??
    (conversation ? readString(conversation, "platform") : null) ??
    channelAccount.platform;

  const rawMessage = readObject(payload, "message");
  const messageId = rawMessage ? readString(rawMessage, "id") : null;
  const direction = rawMessage ? readString(rawMessage, "direction") : null;
  const message =
    type === "conversation.started" || !rawMessage || !messageId
      ? null
      : {
          id: newId(),
          externalMessageId: messageId,
          platformMessageId: readString(rawMessage, "platformMessageId"),
          direction: direction === "outgoing" ? ("outgoing" as const) : ("incoming" as const),
          authorType: direction === "outgoing" ? "BUSINESS" : "CUSTOMER",
          text: typeof rawMessage.text === "string" ? rawMessage.text.slice(0, 8_000) : null,
          attachmentsJson: jsonAttachments(rawMessage),
          occurredAt: readString(rawMessage, "sentAt") ?? nowIso,
        };

  const phone = participantPhone(platform, participantExternalId);
  const existing = await repository.findConversation(ZERNIO_PROVIDER, externalConversationId);
  let leadId = existing?.leadId ?? null;
  let lead: { id: string; name: string; source: string; assignedTo: string | null } | null = null;
  // Sólo se abre lead cuando hay teléfono normalizable: la tabla lo exige y
  // un identificador de Instagram no es un teléfono.
  if (!leadId && phone) {
    leadId = await repository.findLeadIdByPhone(phone);
    if (!leadId) {
      const id = newId();
      lead = {
        id,
        name: leadName(conversation ? readString(conversation, "participantName") : null, platform),
        source: leadSource(platform),
        assignedTo: channelAccount.defaultAssignee,
      };
      leadId = id;
    }
  }

  await repository.ingestMessage({
    provider: ZERNIO_PROVIDER,
    externalEventId,
    channelAccount,
    externalConversationId,
    platform,
    participantExternalId,
    participantPhoneNormalized: phone,
    participantDisplayName:
      (conversation ? readString(conversation, "participantName") : null) ??
      (conversation ? readString(conversation, "participantUsername") : null),
    message,
    conversationId: existing?.id ?? newId(),
    lead,
    leadId,
    leadEventId: message && leadId ? newId() : null,
    occurredAt: message?.occurredAt ?? nowIso,
  });

  // El asesor sólo entra acá, sobre un entrante con texto y una conversación
  // que alguien puso en modo asesor. Las conversaciones nacen en `HUMAN`, así
  // que por defecto nadie recibe una respuesta automática.
  if (type === "message.received" && message && message.direction === "incoming" && message.text) {
    const conversation = await repository.findConversation(
      ZERNIO_PROVIDER,
      externalConversationId,
    );
    if (conversation) {
      await replyIfAdvisorHandles(
        {
          conversationId: conversation.id,
          message: message.text,
          inboundMessageId: message.externalMessageId,
        },
        {
          repository,
          now: input.now,
          ...input.advisorReply,
        },
      );
    }
  }

  return outcomeResponse("processed", existing ? 200 : 201);
}

async function ignore(
  repository: ChannelInboxRepositoryLike,
  externalEventId: string,
  nowIso: string,
  reason: string,
): Promise<Response> {
  await repository.markEvent({
    provider: ZERNIO_PROVIDER,
    externalEventId,
    status: "IGNORED",
    failureReason: reason,
    processedAt: nowIso,
  });
  return outcomeResponse("ignored", 202, reason);
}
