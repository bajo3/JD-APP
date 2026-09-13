import type { ChannelInboxRepositoryLike } from "@/lib/data/channel-inbox-repository";
import { D1ChannelInboxRepository } from "@/lib/data/channel-inbox-repository";
import { adminApiRoute, adminData, hashAdminPayload, requiredEnum, requiredStringArray } from "./admin-api";
import type { AdminAuthOptions } from "./admin-auth";
import { ApiError, readJsonObject, requireIdempotencyKey, requiredString } from "./api";
import {
  ZernioClient,
  type ZernioAccount,
  type ZernioAccountHealth,
  type ZernioManagementClientLike,
  type ZernioWebhook,
} from "./zernio-client";

const WEBHOOK_NAME = "JDA CRM";
export const ZERNIO_INBOX_EVENTS = Object.freeze([
  "message.received",
  "message.sent",
  "conversation.started",
  "message.delivered",
  "message.read",
  "message.failed",
]);

type Runtime = Readonly<{
  auth?: AdminAuthOptions;
  client?: ZernioManagementClientLike;
  repository?: ChannelInboxRepositoryLike;
  apiKey?: string;
  webhookSecret?: string;
  siteUrl?: string;
  now?: Date;
}>;

type SupportedRemotePlatform = "whatsapp" | "instagram" | "facebook";
type LocalPlatform = "whatsapp" | "instagram" | "messenger";

function assertOnlyKeys(payload: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    throw new ApiError(422, "VALIDATION_ERROR", "La solicitud contiene campos no admitidos.");
  }
}

function configuredApiKey(runtime: Runtime): string {
  return (runtime.apiKey ?? process.env.ZERNIO_API_KEY ?? "").trim();
}

function configuredWebhookSecret(runtime: Runtime): string {
  return (runtime.webhookSecret ?? process.env.ZERNIO_WEBHOOK_SECRET ?? "").trim();
}

function requireConfiguredApiKey(runtime: Runtime): void {
  if (configuredApiKey(runtime).length < 16) {
    throw new ApiError(503, "ZERNIO_NOT_CONFIGURED", "Falta configurar la API key de Zernio en Vercel.");
  }
}

function requireWebhookSecret(runtime: Runtime): string {
  const secret = configuredWebhookSecret(runtime);
  if (secret.length < 16) {
    throw new ApiError(503, "ZERNIO_NOT_CONFIGURED", "Falta configurar el secreto del webhook de Zernio en Vercel.");
  }
  return secret;
}

function publicOrigin(runtime: Runtime): string {
  const raw = (runtime.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApiError(503, "ZERNIO_NOT_CONFIGURED", "La URL pública del sitio no está configurada.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if ((!local && parsed.protocol !== "https:") || (local && !["http:", "https:"].includes(parsed.protocol))) {
    throw new ApiError(503, "ZERNIO_NOT_CONFIGURED", "La URL pública del sitio no es segura.");
  }
  return parsed.origin;
}

function client(runtime: Runtime): ZernioManagementClientLike {
  requireConfiguredApiKey(runtime);
  return runtime.client ?? new ZernioClient({ apiKey: configuredApiKey(runtime) });
}

function repository(runtime: Runtime): ChannelInboxRepositoryLike {
  return runtime.repository ?? new D1ChannelInboxRepository();
}

function localPlatform(platform: string): LocalPlatform | null {
  if (platform === "whatsapp" || platform === "instagram") return platform;
  if (platform === "facebook") return "messenger";
  return null;
}

function safeRemoteAccounts(accounts: readonly ZernioAccount[], health: readonly ZernioAccountHealth[]) {
  return accounts.flatMap((account) => {
    const mapped = localPlatform(account.platform);
    if (!mapped) return [];
    const currentHealth = health.find((item) => item.id === account.id);
    const healthy = account.connected && currentHealth?.status === "healthy" && !currentHealth.needsReconnect;
    return [{
      id: account.id,
      profileId: account.profileId,
      platform: account.platform,
      localPlatform: mapped,
      username: account.username,
      displayName: account.displayName,
      connected: healthy,
      health: currentHealth?.status ?? "error",
      needsReconnect: currentHealth?.needsReconnect ?? true,
    }];
  });
}

function safeWebhook(webhooks: readonly ZernioWebhook[], url: string) {
  const matches = webhooks.filter((item) => item.name === WEBHOOK_NAME || item.url === url);
  if (matches.length !== 1) return matches.length > 1 ? { state: "AMBIGUOUS" as const } : null;
  const webhook = matches[0];
  return {
    state: webhook.isActive && webhook.failureCount === 0 ? ("READY" as const) : ("NEEDS_ATTENTION" as const),
    id: webhook.id,
    isActive: webhook.isActive,
    failureCount: webhook.failureCount,
    lastFiredAt: webhook.lastFiredAt,
    eventsComplete: ZERNIO_INBOX_EVENTS.every((event) => webhook.events.includes(event)),
  };
}

function providerState(error: unknown): "INVALID_CREDENTIALS" | "UNAVAILABLE" {
  if (error instanceof ApiError && error.code === "ZERNIO_INVALID_CREDENTIALS") return "INVALID_CREDENTIALS";
  return "UNAVAILABLE";
}

export function adminZernioStatus(request: Request, runtime: Runtime = {}): Promise<Response> {
  return adminApiRoute(request, async () => {
    const keyConfigured = configuredApiKey(runtime).length >= 16;
    const webhookSecretConfigured = configuredWebhookSecret(runtime).length >= 16;
    let origin: string | null = null;
    try {
      origin = publicOrigin(runtime);
    } catch {
      // El DTO de estado explica que falta configuración sin filtrar valores.
    }
    const webhookUrl = origin ? `${origin}/api/v1/webhooks/zernio` : null;
    if (!keyConfigured) {
      return adminData({
        state: "NOT_CONFIGURED",
        keyConfigured,
        webhookSecretConfigured,
        webhookUrl,
        profiles: [],
        remoteAccounts: [],
        localAccountIds: [],
        webhook: null,
      });
    }

    const service = client(runtime);
    try {
      const [profiles, accounts, health, webhooks, localAccounts] = await Promise.all([
        service.listProfiles(),
        service.listAccounts(),
        service.getAccountsHealth(),
        service.listWebhooks(),
        repository(runtime).listChannelAccounts(),
      ]);
      return adminData({
        state: "READY",
        keyConfigured,
        webhookSecretConfigured,
        webhookUrl,
        profiles,
        remoteAccounts: safeRemoteAccounts(accounts, health),
        localAccountIds: localAccounts.map((account) => account.externalAccountId),
        webhook: webhookUrl ? safeWebhook(webhooks, webhookUrl) : null,
      });
    } catch (error) {
      return adminData({
        state: providerState(error),
        keyConfigured,
        webhookSecretConfigured,
        webhookUrl,
        profiles: [],
        remoteAccounts: [],
        localAccountIds: [],
        webhook: null,
      });
    }
  }, runtime.auth);
}

export function adminZernioConnect(request: Request, runtime: Runtime = {}): Promise<Response> {
  return adminApiRoute(request, async () => {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform")?.trim() as SupportedRemotePlatform | undefined;
    const profileId = url.searchParams.get("profileId")?.trim() ?? "";
    if (!platform || !["whatsapp", "instagram", "facebook"].includes(platform)) {
      throw new ApiError(422, "ZERNIO_UNSUPPORTED_PLATFORM", "Ese canal no se puede conectar desde el panel.");
    }
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(profileId)) {
      throw new ApiError(404, "ZERNIO_PROFILE_NOT_FOUND", "El perfil de Zernio no existe.");
    }
    const service = client(runtime);
    const profiles = await service.listProfiles();
    if (!profiles.some((profile) => profile.id === profileId)) {
      throw new ApiError(404, "ZERNIO_PROFILE_NOT_FOUND", "El perfil de Zernio no existe.");
    }
    const redirectUrl = `${publicOrigin(runtime)}/panel/conversaciones?zernio=callback`;
    const authUrl = await service.getConnectUrl({ platform, profileId, redirectUrl });
    return adminData({ authUrl });
  }, runtime.auth);
}

export function adminZernioSync(request: Request, runtime: Runtime = {}): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    assertOnlyKeys(payload, ["profileId", "accountIds"]);
    const profileId = requiredString(payload, "profileId", { min: 3, max: 120 });
    const accountIds = requiredStringArray(payload, "accountIds", { min: 1, max: 20 });
    const service = client(runtime);
    const [profiles, remoteAccounts, health] = await Promise.all([
      service.listProfiles(),
      service.listAccounts(),
      service.getAccountsHealth(),
    ]);
    if (!profiles.some((profile) => profile.id === profileId)) {
      throw new ApiError(404, "ZERNIO_PROFILE_NOT_FOUND", "El perfil de Zernio no existe.");
    }
    const selected = accountIds.map((id) => remoteAccounts.find((account) => account.id === id));
    if (selected.some((account) => !account || account.profileId !== profileId)) {
      throw new ApiError(422, "ZERNIO_ACCOUNT_NOT_FOUND", "Una cuenta seleccionada no pertenece al perfil.");
    }
    const accounts = selected.map((account) => {
      const verified = account as ZernioAccount;
      const platform = localPlatform(verified.platform);
      if (!platform) {
        throw new ApiError(422, "ZERNIO_UNSUPPORTED_PLATFORM", "Una cuenta seleccionada no admite conversaciones.");
      }
      const currentHealth = health.find((item) => item.id === verified.id);
      return {
        id: crypto.randomUUID(),
        platform,
        externalAccountId: verified.id,
        displayName: verified.displayName,
        status:
          verified.connected && currentHealth?.status === "healthy" && !currentHealth.needsReconnect
            ? ("ACTIVE" as const)
            : ("PAUSED" as const),
      };
    });
    const requestHash = await hashAdminPayload({ profileId, accountIds: [...accountIds].sort() });
    const result = await repository(runtime).syncChannelAccounts({
      idempotencyKey,
      requestHash,
      profileId,
      accounts,
      actor,
      updatedAt: (runtime.now ?? new Date()).toISOString(),
    });
    if (!result.ok) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otros datos.");
    return adminData(result);
  }, runtime.auth);
}

export function adminZernioWebhook(request: Request, runtime: Runtime = {}): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    assertOnlyKeys(payload, ["action"]);
    const action = requiredEnum(payload, "action", ["ensure", "test"] as const);
    const requestHash = await hashAdminPayload({ action });
    const scope = `zernio.webhook.${action}`;
    const store = repository(runtime);
    const replay = await store.findIntegrationAction(scope, idempotencyKey);
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otros datos.");
      }
      return adminData({ action, replayed: true, webhookId: replay.resourceId });
    }

    const webhookUrl = `${publicOrigin(runtime)}/api/v1/webhooks/zernio`;
    const service = client(runtime);
    const matches = (await service.listWebhooks()).filter(
      (item) => item.name === WEBHOOK_NAME || item.url === webhookUrl,
    );
    if (matches.length > 1) {
      throw new ApiError(409, "ZERNIO_WEBHOOK_AMBIGUOUS", "Hay más de un webhook de JDA en Zernio.");
    }
    let webhook = matches[0] ?? null;
    if (action === "ensure") {
      const secret = requireWebhookSecret(runtime);
      webhook = webhook
        ? await service.updateWebhook({
            id: webhook.id,
            name: WEBHOOK_NAME,
            url: webhookUrl,
            secret,
            events: ZERNIO_INBOX_EVENTS,
            idempotencyKey,
          })
        : await service.createWebhook({
            name: WEBHOOK_NAME,
            url: webhookUrl,
            secret,
            events: ZERNIO_INBOX_EVENTS,
            idempotencyKey,
          });
    } else {
      if (!webhook) {
        throw new ApiError(409, "ZERNIO_WEBHOOK_NOT_FOUND", "Primero configurá el webhook de JDA.");
      }
      await service.testWebhook({ id: webhook.id, idempotencyKey });
    }
    if (!webhook) throw new ApiError(502, "ZERNIO_WEBHOOK_TEST_FAILED", "No se pudo verificar el webhook.");
    const recorded = await store.recordIntegrationAction({
      scope,
      idempotencyKey,
      requestHash,
      resourceId: webhook.id,
      action: `zernio.webhook.${action}`,
      actor,
      occurredAt: (runtime.now ?? new Date()).toISOString(),
      summary: { action, webhookUrl },
    });
    if (recorded === "conflict") {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otros datos.");
    }
    return adminData({ action, replayed: recorded === "replayed", webhookId: webhook.id });
  }, runtime.auth);
}
