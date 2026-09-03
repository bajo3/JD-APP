import { ApiError } from "./api";

const DEFAULT_BASE_URL = "https://zernio.com/api";
const DEFAULT_TIMEOUT_MS = 10_000;

/** WhatsApp rechaza la ráfaga al mismo destinatario con este código. */
export const WHATSAPP_TOO_MANY_TO_RECIPIENT = 131056;

export type SentMessage = Readonly<{
  externalMessageId: string;
  externalConversationId: string | null;
}>;

export type ZernioTemplate = Readonly<{
  name: string;
  language: string;
  params?: readonly string[];
}>;

export type ZernioClientLike = {
  sendText(input: {
    externalConversationId: string;
    externalAccountId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<SentMessage>;
  startWithTemplate(input: {
    externalAccountId: string;
    participantId: string;
    template: ZernioTemplate;
    idempotencyKey: string;
  }): Promise<SentMessage>;
};

function requireApiKey(explicit?: string): string {
  const key = (explicit ?? process.env.ZERNIO_API_KEY ?? "").trim();
  if (key.length < 16) {
    throw new ApiError(
      503,
      "MESSAGING_NOT_CONFIGURED",
      "El puente de mensajería no está configurado para enviar.",
    );
  }
  return key;
}

function baseUrl(): string {
  const configured = process.env.ZERNIO_API_BASE_URL?.trim();
  if (!configured) return DEFAULT_BASE_URL;
  return configured.replace(/\/+$/, "");
}

function readMessage(body: unknown): SentMessage {
  const data =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).data
      : null;
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const messageId = typeof record.messageId === "string" ? record.messageId.trim() : "";
  if (!messageId) {
    // Sin identificador no se puede dejar el saliente en la bandeja sin
    // arriesgar duplicarlo cuando llegue el webhook: se trata como falla.
    throw new ApiError(
      502,
      "MESSAGING_UNEXPECTED_RESPONSE",
      "El puente no devolvió el identificador del mensaje.",
    );
  }
  const conversationId =
    typeof record.conversationId === "string" && record.conversationId.trim().length > 0
      ? record.conversationId.trim()
      : null;
  return { externalMessageId: messageId, externalConversationId: conversationId };
}

/**
 * Cliente HTTP del puente. Traduce los errores del proveedor a los mismos
 * códigos que usa el resto de la API para que el circuito de salida decida
 * con una sola forma de error, no con el cuerpo crudo de un tercero.
 */
export class ZernioClient implements ZernioClientLike {
  constructor(
    private readonly options: {
      apiKey?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {}

  private async post(path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
    const apiKey = requireApiKey(this.options.apiKey);
    const doFetch = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${baseUrl()}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(
        502,
        "MESSAGING_UNAVAILABLE",
        "No pudimos contactar al puente de mensajería.",
      );
    }

    const payload = await response.json().catch(() => null);
    if (response.ok) return payload;

    const code =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).code
        : null;
    const platformError =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).platformError
        : null;
    const platformCode =
      platformError && typeof platformError === "object" && !Array.isArray(platformError)
        ? Number((platformError as Record<string, unknown>).code)
        : Number.NaN;

    if (platformCode === WHATSAPP_TOO_MANY_TO_RECIPIENT || response.status === 429) {
      throw new ApiError(
        429,
        "RECIPIENT_PACE_EXCEEDED",
        "El destinatario recibió demasiados mensajes seguidos.",
        undefined,
        { "Retry-After": "60" },
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        503,
        "MESSAGING_NOT_CONFIGURED",
        "El puente de mensajería rechazó las credenciales.",
      );
    }
    if (typeof code === "string" && code.toUpperCase() === "TEMPLATE_REQUIRED") {
      throw new ApiError(
        409,
        "TEMPLATE_REQUIRED",
        "Fuera de la ventana de 24 horas hace falta una plantilla aprobada.",
      );
    }
    throw new ApiError(
      502,
      "MESSAGING_REJECTED",
      "El puente de mensajería rechazó el envío.",
    );
  }

  async sendText(input: {
    externalConversationId: string;
    externalAccountId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<SentMessage> {
    const payload = await this.post(
      `/v1/inbox/conversations/${encodeURIComponent(input.externalConversationId)}/messages`,
      { accountId: input.externalAccountId, message: input.text },
      input.idempotencyKey,
    );
    return readMessage(payload);
  }

  async startWithTemplate(input: {
    externalAccountId: string;
    participantId: string;
    template: ZernioTemplate;
    idempotencyKey: string;
  }): Promise<SentMessage> {
    const payload = await this.post(
      "/v1/inbox/conversations",
      {
        accountId: input.externalAccountId,
        participantId: input.participantId,
        templateName: input.template.name,
        templateLanguage: input.template.language,
        ...(input.template.params && input.template.params.length > 0
          ? { templateParams: [...input.template.params] }
          : {}),
      },
      input.idempotencyKey,
    );
    return readMessage(payload);
  }
}
