"use client";

import { useState } from "react";

type Account = Readonly<{
  id: string;
  platform: string;
  displayName: string;
  status: string;
  advisorEnabled: boolean;
  version: number;
}>;

const PLATFORM_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

export function ChannelAdvisorControls({
  accounts,
  canActivate,
}: {
  accounts: readonly Account[];
  canActivate: boolean;
}) {
  const [rows, setRows] = useState(accounts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function update(account: Account) {
    setBusyId(account.id);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/zernio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          enabled: !account.advisorEnabled,
          expectedVersion: account.version,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        data?: { advisorEnabled?: boolean; version?: number };
        error?: { message?: string };
      } | null;
      if (!response.ok || typeof payload?.data?.version !== "number") {
        throw new Error(payload?.error?.message ?? "No se pudo cambiar el asesor.");
      }
      setRows((current) => current.map((row) => row.id === account.id ? {
        ...row,
        advisorEnabled: Boolean(payload.data?.advisorEnabled),
        version: Number(payload.data?.version),
      } : row));
      setMessage(payload.data.advisorEnabled
        ? `Asesor activado para ${account.displayName}. Las conversaciones nuevas podrán responderse automáticamente.`
        : `Asesor desactivado para ${account.displayName}. Las conversaciones quedan en atención humana.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar el asesor.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <p className="panel-muted">Primero sincronizá una cuenta de Zernio.</p>;
  }

  return (
    <div className="advisor-channel-settings">
      <ul className="channel-account-list">
        {rows.map((account) => (
          <li key={account.id}>
            <span className="channel-platform-mark" aria-hidden="true">{account.platform.slice(0, 1).toUpperCase()}</span>
            <span className="channel-account-copy">
              <strong>{PLATFORM_LABEL[account.platform] ?? account.platform}</strong>
              <small>{account.displayName} · {account.status === "ACTIVE" ? "conectada" : "pausada"}</small>
            </span>
            <span className={`advisor-status${account.advisorEnabled ? " is-enabled" : ""}`}>
              {account.advisorEnabled ? "Agente activo" : "Atención humana"}
            </span>
            <button
              type="button"
              className={`panel-action${account.advisorEnabled ? "" : " panel-primary"}`}
              disabled={busyId !== null || account.status !== "ACTIVE" || (!account.advisorEnabled && !canActivate)}
              onClick={() => update(account)}
            >
              {busyId === account.id ? "Guardando…" : account.advisorEnabled ? "Desactivar" : "Activar agente"}
            </button>
          </li>
        ))}
      </ul>
      {!canActivate ? <p className="settings-warning" role="note">Falta configurar la clave de IA en Vercel. Los canales permanecen en atención humana.</p> : null}
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
    </div>
  );
}
