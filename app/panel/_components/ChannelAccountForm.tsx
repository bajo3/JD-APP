"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ZernioProfile = Record<string, unknown>;
type ZernioRemoteAccount = Record<string, unknown>;
type ZernioWebhook = Record<string, unknown>;

type ZernioStatus = {
  state?: string;
  keyConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookUrl?: string | null;
  profiles: ZernioProfile[];
  remoteAccounts: ZernioRemoteAccount[];
  webhook?: ZernioWebhook | null;
};

type ZernioResponse = { data?: Record<string, unknown>; error?: { message?: string } };

const PLATFORM_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
] as const;

function listValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function stringValue(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function profileId(profile: ZernioProfile): string {
  return stringValue(profile, "id", "profileId", "key");
}

function accountId(account: ZernioRemoteAccount): string {
  return stringValue(account, "id", "accountId");
}

function profileLabel(profile: ZernioProfile): string {
  return stringValue(profile, "name", "displayName", "label", "email") || "Perfil sin nombre";
}

function accountLabel(account: ZernioRemoteAccount): string {
  return stringValue(account, "displayName", "name", "username", "phoneNumber", "phone") || "Cuenta sin nombre";
}

function accountPlatform(account: ZernioRemoteAccount): string {
  return stringValue(account, "platform", "channel", "type").toLowerCase();
}

function accountProfileId(account: ZernioRemoteAccount): string {
  return stringValue(account, "profileId", "profile_id");
}

function selectableAccountIds(accounts: ZernioRemoteAccount[], profile: string, platform: string): string[] {
  return accounts.filter((account) => {
    const remoteProfile = accountProfileId(account);
    const remotePlatform = accountPlatform(account);
    return (!remoteProfile || remoteProfile === profile) && (!remotePlatform || remotePlatform === platform);
  }).map(accountId).filter(Boolean);
}

function errorMessage(response: Response, payload: ZernioResponse | null, fallback: string): string {
  return payload?.error?.message || `${fallback} (${response.status})`;
}

function statusText(status: ZernioStatus | null): string {
  if (!status) return "";
  if (!status.keyConfigured) return "Falta la API key de Zernio";
  if (!status.webhookSecretConfigured) return "Canales habilitados; falta el secreto del webhook";
  if (status.webhook && stringValue(status.webhook, "status").toLowerCase() === "error") return "Webhook con errores";
  return "Zernio listo para conectar";
}

export function ChannelAccountForm() {
  const [status, setStatus] = useState<ZernioStatus | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<(typeof PLATFORM_OPTIONS)[number]["value"]>("whatsapp");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"connect" | "sync" | "webhook-ensure" | "webhook-test" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const idempotencyKeys = useRef<Record<string, string | null>>({});
  const selectionRef = useRef({ profileId: "", platform: "whatsapp" });

  const loadStatus = useCallback(async (): Promise<ZernioStatus> => {
    const response = await fetch("/api/v1/admin/zernio", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as ZernioResponse | null;
    if (!response.ok || !payload?.data) throw new Error(errorMessage(response, payload, "No se pudo cargar Zernio."));
    const data = {
      state: typeof payload.data.state === "string" ? payload.data.state : undefined,
      keyConfigured: payload.data.keyConfigured === true,
      webhookSecretConfigured: payload.data.webhookSecretConfigured === true,
      webhookUrl: typeof payload.data.webhookUrl === "string" ? payload.data.webhookUrl : null,
      profiles: listValue(payload.data.profiles),
      remoteAccounts: listValue(payload.data.remoteAccounts),
      webhook: payload.data.webhook && typeof payload.data.webhook === "object" ? payload.data.webhook as ZernioWebhook : null,
    } satisfies ZernioStatus;
    setStatus(data);
    const nextProfileId = data.profiles.some((profile) => profileId(profile) === selectionRef.current.profileId)
      ? selectionRef.current.profileId
      : profileId(data.profiles[0] ?? {});
    selectionRef.current.profileId = nextProfileId;
    setSelectedProfileId(nextProfileId);
    setSelectedAccountIds(selectableAccountIds(data.remoteAccounts, nextProfileId, selectionRef.current.platform));
    if (data.state && data.state !== "READY" && data.state !== "NOT_CONFIGURED") {
      setError("No se pudo consultar Zernio. Revisá la configuración y reintentá.");
    } else {
      setError("");
    }
    return data;
  }, []);

  const postAction = useCallback(async (path: string, body: Record<string, unknown>, action: string) => {
    idempotencyKeys.current[action] ??= crypto.randomUUID();
    const key = idempotencyKeys.current[action];
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key ?? "" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as ZernioResponse | null;
    if (!response.ok) throw new Error(errorMessage(response, payload, "No se pudo completar la operación."));
    idempotencyKeys.current[action] = null;
    return payload;
  }, []);

  useEffect(() => {
    let active = true;
    const marker = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("zernio");
    if (marker === "callback" || marker === "cancelled") {
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, "", cleanUrl);
    }
    void (async () => {
      setLoading(true);
      try {
        const next = await loadStatus();
        if (!active) return;
        if (marker === "cancelled") {
          setMessage("La conexión con Zernio fue cancelada. Podés intentarlo de nuevo.");
        } else if (marker === "callback") {
          setMessage("Autorización recibida. Actualizando canales…");
          const pendingProfileId = window.sessionStorage.getItem("jda:zernio-profile") ?? "";
          window.sessionStorage.removeItem("jda:zernio-profile");
          const profile = next.profiles.find((item) => profileId(item) === pendingProfileId) ?? next.profiles[0];
          const id = profileId(profile ?? {});
          const ids = next.remoteAccounts
            .filter((account) => !accountProfileId(account) || accountProfileId(account) === id)
            .map(accountId)
            .filter(Boolean);
          if (id && ids.length > 0) {
            await postAction("/api/v1/admin/zernio/sync", { profileId: id, accountIds: ids }, "callback-sync");
            await loadStatus();
            setMessage("Canales sincronizados. Elegí las cuentas que querés enrutar.");
          } else {
            setMessage("Autorización recibida. No hay cuentas para sincronizar todavía.");
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el estado de Zernio.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadStatus, postAction]);

  const visibleAccounts = useMemo(() => {
    if (!status) return [];
    return status.remoteAccounts.filter((account) => {
      const accountProfile = accountProfileId(account);
      const platform = accountPlatform(account);
      return (!accountProfile || accountProfile === selectedProfileId) && (!platform || platform === selectedPlatform);
    });
  }, [selectedPlatform, selectedProfileId, status]);

  async function beginOAuth() {
    if (!selectedProfileId) return setError("Elegí un perfil antes de conectar un canal.");
    setBusyAction("connect");
    setError("");
    try {
      const params = new URLSearchParams({ platform: selectedPlatform, profileId: selectedProfileId });
      const response = await fetch(`/api/v1/admin/zernio/connect?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as ZernioResponse | null;
      const authUrl = typeof payload?.data?.authUrl === "string" ? payload.data.authUrl : "";
      if (!response.ok || !authUrl) throw new Error(errorMessage(response, payload, "No se pudo iniciar la conexión."));
      const parsedUrl = new URL(authUrl, window.location.origin);
      if (parsedUrl.protocol !== "https:" && parsedUrl.origin !== window.location.origin) throw new Error("Zernio devolvió una URL de conexión inválida.");
      window.sessionStorage.setItem("jda:zernio-profile", selectedProfileId);
      window.location.assign(parsedUrl.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la conexión.");
      setBusyAction(null);
    }
  }

  async function syncAccounts() {
    if (!selectedProfileId) return setError("Elegí un perfil antes de sincronizar.");
    if (selectedAccountIds.length === 0) return setError("Seleccioná al menos una cuenta remota.");
    setBusyAction("sync");
    setError("");
    try {
      await postAction("/api/v1/admin/zernio/sync", { profileId: selectedProfileId, accountIds: selectedAccountIds }, "sync");
      await loadStatus();
      setMessage("Cuentas sincronizadas en la bandeja.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron sincronizar las cuentas.");
    } finally {
      setBusyAction(null);
    }
  }

  async function configureWebhook(action: "ensure" | "test") {
    const actionName = action === "ensure" ? "webhook-ensure" : "webhook-test";
    setBusyAction(actionName);
    setError("");
    try {
      await postAction("/api/v1/admin/zernio/webhook", { action }, actionName);
      await loadStatus();
      setMessage(action === "ensure" ? "Webhook configurado." : "Prueba del webhook enviada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el webhook.");
    } finally {
      setBusyAction(null);
    }
  }

  const providerUnavailable = Boolean(status?.state && status.state !== "READY" && status.state !== "NOT_CONFIGURED");
  const providerReady = Boolean(status?.keyConfigured && !providerUnavailable);
  const webhookStatus = status?.webhook ? stringValue(status.webhook, "status", "state") : "No configurado";

  return (
    <div className="channel-account-form zernio-manager">
      <div className="zernio-manager-head">
        <div>
          <p className="panel-kicker">GESTOR ZERNIO</p>
          <h3>Conectá tus canales</h3>
          <p className="panel-muted">La conexión se autoriza en Zernio; las claves nunca se cargan desde este panel.</p>
        </div>
        <span className={`zernio-state-badge${providerReady ? " is-ready" : ""}`} aria-label={statusText(status)}>
          {loading ? "Cargando…" : providerReady ? "Listo" : "Pendiente"}
        </span>
      </div>

      {loading ? <p className="zernio-feedback" role="status">Cargando estado de Zernio…</p> : null}
      {error ? <div className="zernio-error" role="alert"><span>{error}</span><button className="panel-action" type="button" onClick={() => { setError(""); setLoading(true); void loadStatus().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo reintentar.")).finally(() => setLoading(false)); }}>Reintentar</button></div> : null}
      {message ? <p className="admin-feedback zernio-feedback" role="status">{message}</p> : null}

      {!loading && !providerReady && !providerUnavailable ? (
        <div className="zernio-step is-blocked">
          <span className="zernio-step-number">1</span>
          <div><strong>Credenciales</strong><p>Un administrador debe configurar la API key y el secreto del webhook en Vercel para habilitar la conexión.</p></div>
        </div>
      ) : null}

      {!loading && providerReady ? (
        <div className="zernio-steps">
          <div className="zernio-step">
            <span className="zernio-step-number">1</span>
            <div className="zernio-step-body"><strong>Credenciales</strong><p className="zernio-step-ok">API key configurada en el servidor.</p></div>
          </div>

          <div className="zernio-step">
            <span className="zernio-step-number">2</span>
            <div className="zernio-step-body">
              <label htmlFor="zernio-profile"><strong>Perfil de Zernio</strong></label>
              {status?.profiles.length ? (
                <select id="zernio-profile" value={selectedProfileId} onChange={(event) => { const nextProfileId = event.target.value; selectionRef.current.profileId = nextProfileId; setSelectedProfileId(nextProfileId); setSelectedAccountIds(selectableAccountIds(status?.remoteAccounts ?? [], nextProfileId, selectionRef.current.platform)); }}>
                  {status.profiles.map((profile) => <option key={profileId(profile)} value={profileId(profile)}>{profileLabel(profile)}</option>)}
                </select>
              ) : <p className="zernio-empty">No hay perfiles disponibles. Conectá uno desde Zernio y reintentá.</p>}
            </div>
          </div>

          <div className="zernio-step">
            <span className="zernio-step-number">3</span>
            <div className="zernio-step-body">
              <strong>Canal y cuentas</strong>
              <div className="zernio-platforms" role="group" aria-label="Elegir canal">
                {PLATFORM_OPTIONS.map((platform) => <button key={platform.value} className={`panel-action${selectedPlatform === platform.value ? " is-selected" : ""}`} type="button" aria-pressed={selectedPlatform === platform.value} onClick={() => { selectionRef.current.platform = platform.value; setSelectedPlatform(platform.value); setSelectedAccountIds(selectableAccountIds(status?.remoteAccounts ?? [], selectedProfileId, platform.value)); }}>{platform.label}</button>)}
              </div>
              {visibleAccounts.length ? (
                <fieldset className="zernio-account-picker"><legend>Elegí las cuentas que entran en la bandeja</legend>{visibleAccounts.map((account) => { const id = accountId(account); return <label key={id}><input type="checkbox" checked={selectedAccountIds.includes(id)} onChange={(event) => setSelectedAccountIds((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))} /><span>{accountLabel(account)}</span></label>; })}</fieldset>
              ) : <p className="zernio-empty">No hay cuentas remotas para este perfil y canal. Iniciá la conexión en el próximo paso.</p>}
              <button className="primary-button" type="button" disabled={!selectedProfileId || busyAction !== null} onClick={beginOAuth}>{busyAction === "connect" ? "Abriendo Zernio…" : "Conectar canal en Zernio"}</button>
            </div>
          </div>

          <div className="zernio-step">
            <span className="zernio-step-number">4</span>
            <div className="zernio-step-body"><strong>Sincronización</strong><p>Las cuentas elegidas se guardarán en la bandeja con el estado que informa Zernio.</p><button className="primary-button" type="button" disabled={busyAction !== null || selectedAccountIds.length === 0} onClick={syncAccounts}>{busyAction === "sync" ? "Sincronizando…" : "Sincronizar cuentas"}</button></div>
          </div>

          <div className="zernio-step">
            <span className="zernio-step-number">5</span>
            <div className="zernio-step-body"><strong>Webhook</strong><p>Estado: <b>{webhookStatus || "No configurado"}</b>{status?.webhookUrl ? <> · <code>{status.webhookUrl}</code></> : null}</p>{!status?.webhookSecretConfigured ? <p className="zernio-empty">Falta configurar <code>ZERNIO_WEBHOOK_SECRET</code> en Vercel. Los canales se pueden autorizar, pero todavía no recibirán eventos.</p> : null}<div className="zernio-inline-actions"><button className="panel-action" type="button" disabled={busyAction !== null || !status?.webhookSecretConfigured} onClick={() => configureWebhook("ensure")}>{busyAction === "webhook-ensure" ? "Configurando…" : "Configurar webhook"}</button><button className="panel-action" type="button" disabled={busyAction !== null || !status?.webhook} onClick={() => configureWebhook("test")}>{busyAction === "webhook-test" ? "Probando…" : "Probar webhook"}</button></div></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
