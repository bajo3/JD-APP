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

export type ZernioProfile = Readonly<{
  id: string;
  name: string;
  isDefault: boolean;
}>;

export type ZernioAccount = Readonly<{
  id: string;
  profileId: string | null;
  platform: string;
  username: string | null;
  displayName: string;
  connected: boolean;
}>;

export type ZernioAccountHealth = Readonly<{
  id: string;
  status: "healthy" | "warning" | "error";
  needsReconnect: boolean;
}>;

export type ZernioWebhook = Readonly<{
  id: string;
  name: string;
  url: string;
  events: readonly string[];
  isActive: boolean;
  failureCount: number;
  lastFiredAt: string | null;
}>;

export type ZernioManagementClientLike = {
  listProfiles(): Promise<readonly ZernioProfile[]>;
  listAccounts(): Promise<readonly ZernioAccount[]>;
  getAccountsHealth(): Promise<readonly ZernioAccountHealth[]>;
  getConnectUrl(input: {
    platform: "whatsapp" | "instagram" | "facebook";
    profileId: string;
    redirectUrl: string;
  }): Promise<string>;
  listWebhooks(): Promise<readonly ZernioWebhook[]>;
  createWebhook(input: {
    name: string;
    url: string;
    secret: string;
    events: readonly string[];
    idempotencyKey: string;
  }): Promise<ZernioWebhook>;
  updateWebhook(input: {
    id: string;
    name: string;
    url: string;
    secret: string;
    events: readonly string[];
    idempotencyKey: string;
  }): Promise<ZernioWebhook>;
  testWebhook(input: { id: string; idempotencyKey: string }): Promise<void>;
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function providerFailure(status: number, payload: unknown): ApiError {
  const body = record(payload);
  const providerCode = cleanString(body?.code, 80)?.toLowerCase();
  if (status === 401 || status === 403) {
    return new ApiError(503, "ZERNIO_INVALID_CREDENTIALS", "Zernio rechazó las credenciales configuradas.");
  }
  if (status === 402 || providerCode === "payment_required") {
    return new ApiError(409, "ZERNIO_PAYMENT_REQUIRED", "El plan de Zernio no permite completar la conexión.");
  }
  if (status === 429) {
    return new ApiError(429, "ZERNIO_RATE_LIMITED", "Zernio pidió esperar antes de volver a intentar.", undefined, {
      "Retry-After": "60",
    });
  }
  return new ApiError(502, "ZERNIO_REJECTED", "Zernio rechazó la operación solicitada.");
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

  private async managementRequest(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const apiKey = requireApiKey(this.options.apiKey);
    const doFetch = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ApiError(502, "ZERNIO_UNAVAILABLE", "No pudimos contactar a Zernio.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw providerFailure(response.status, payload);
    const parsed = record(payload);
    if (!parsed) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió una respuesta inesperada.");
    }
    return parsed;
  }

  async listProfiles(): Promise<readonly ZernioProfile[]> {
    const payload = await this.managementRequest("GET", "/v1/profiles");
    if (!Array.isArray(payload.profiles)) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió perfiles inválidos.");
    }
    return payload.profiles.map((item) => {
      const value = record(item);
      const id = cleanString(value?._id, 120) ?? cleanString(value?.id, 120);
      const name = cleanString(value?.name, 120);
      if (!id || !name) {
        throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió perfiles inválidos.");
      }
      return { id, name, isDefault: value?.isDefault === true };
    });
  }

  async listAccounts(): Promise<readonly ZernioAccount[]> {
    const payload = await this.managementRequest("GET", "/v1/accounts");
    if (!Array.isArray(payload.accounts)) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió cuentas inválidas.");
    }
    return payload.accounts.map((item) => {
      const value = record(item);
      const profile = record(value?.profileId);
      const id = cleanString(value?._id, 120) ?? cleanString(value?.id, 120);
      const platform = cleanString(value?.platform, 40)?.toLowerCase();
      const displayName = cleanString(value?.displayName, 120) ?? cleanString(value?.username, 120);
      if (!id || !platform || !displayName) {
        throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió cuentas inválidas.");
      }
      return {
        id,
        profileId: cleanString(profile?._id, 120) ?? cleanString(value?.profileId, 120),
        platform,
        username: cleanString(value?.username, 120),
        displayName,
        connected: value?.isActive === true,
      };
    });
  }

  async getAccountsHealth(): Promise<readonly ZernioAccountHealth[]> {
    const payload = await this.managementRequest("GET", "/v1/accounts/health");
    if (!Array.isArray(payload.accounts)) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió estados de cuenta inválidos.");
    }
    return payload.accounts.map((item) => {
      const value = record(item);
      const id = cleanString(value?.accountId, 120);
      const status = cleanString(value?.status, 20)?.toLowerCase();
      if (!id || !status || !["healthy", "warning", "error"].includes(status)) {
        throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió estados de cuenta inválidos.");
      }
      return {
        id,
        status: status as ZernioAccountHealth["status"],
        needsReconnect: value?.needsReconnect === true,
      };
    });
  }

  async getConnectUrl(input: {
    platform: "whatsapp" | "instagram" | "facebook";
    profileId: string;
    redirectUrl: string;
  }): Promise<string> {
    const query = new URLSearchParams({ profileId: input.profileId, redirect_url: input.redirectUrl });
    if (input.platform === "whatsapp") {
      query.set("signup", "hosted");
      query.set("language", "es");
      query.set("brandName", "Jesús Díaz Automotores");
    }
    const payload = await this.managementRequest(
      "GET",
      `/v1/connect/${encodeURIComponent(input.platform)}?${query.toString()}`,
    );
    const authUrl = cleanString(payload.authUrl, 4_000);
    if (!authUrl) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio no devolvió la URL de conexión.");
    }
    let parsed: URL;
    try {
      parsed = new URL(authUrl);
    } catch {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió una URL de conexión inválida.");
    }
    if (parsed.protocol !== "https:") {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió una URL de conexión insegura.");
    }
    return parsed.toString();
  }

  async listWebhooks(): Promise<readonly ZernioWebhook[]> {
    const payload = await this.managementRequest("GET", "/v1/webhooks/settings");
    if (!Array.isArray(payload.webhooks)) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió webhooks inválidos.");
    }
    return payload.webhooks.map((item) => this.readWebhook(item));
  }

  async createWebhook(input: {
    name: string;
    url: string;
    secret: string;
    events: readonly string[];
    idempotencyKey: string;
  }): Promise<ZernioWebhook> {
    const payload = await this.managementRequest("POST", "/v1/webhooks/settings", {
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: [...input.events],
      isActive: true,
    }, input.idempotencyKey);
    return this.readWebhook(payload.webhook);
  }

  async updateWebhook(input: {
    id: string;
    name: string;
    url: string;
    secret: string;
    events: readonly string[];
    idempotencyKey: string;
  }): Promise<ZernioWebhook> {
    const payload = await this.managementRequest("PUT", "/v1/webhooks/settings", {
      _id: input.id,
      name: input.name,
      url: input.url,
      secret: input.secret,
      events: [...input.events],
      isActive: true,
    }, input.idempotencyKey);
    return this.readWebhook(payload.webhook);
  }

  async testWebhook(input: { id: string; idempotencyKey: string }): Promise<void> {
    const payload = await this.managementRequest(
      "POST",
      "/v1/webhooks/test",
      { webhookId: input.id },
      input.idempotencyKey,
    );
    if (payload.success !== true) {
      throw new ApiError(502, "ZERNIO_WEBHOOK_TEST_FAILED", "Zernio no pudo entregar el webhook de prueba.");
    }
  }

  private readWebhook(value: unknown): ZernioWebhook {
    const webhook = record(value);
    const id = cleanString(webhook?._id, 120) ?? cleanString(webhook?.id, 120);
    const name = cleanString(webhook?.name, 120);
    const url = cleanString(webhook?.url, 2_000);
    if (!id || !name || !url || !Array.isArray(webhook?.events)) {
      throw new ApiError(502, "ZERNIO_UNEXPECTED_RESPONSE", "Zernio devolvió un webhook inválido.");
    }
    return {
      id,
      name,
      url,
      events: webhook.events.filter((item): item is string => typeof item === "string").slice(0, 50),
      isActive: webhook.isActive === true,
      failureCount: Number.isSafeInteger(webhook.failureCount) ? Number(webhook.failureCount) : 0,
      lastFiredAt: cleanString(webhook.lastFiredAt, 80),
    };
  }

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
        cache: "no-store",
        redirect: "error",
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
