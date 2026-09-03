"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

export function ChannelAccountForm() {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("Guardando…");
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/v1/admin/channel-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          platform: String(data.get("platform") ?? ""),
          externalAccountId: String(data.get("externalAccountId") ?? "").trim(),
          displayName: String(data.get("displayName") ?? "").trim(),
          status: "ACTIVE",
          defaultAssignee: String(data.get("defaultAssignee") ?? "").trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "No se pudo dar de alta la cuenta.");
      }
      idempotencyKey.current = null;
      form.reset();
      setMessage("Cuenta conectada.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="channel-account-form">
      <button className="panel-action" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? "Cerrar" : "Conectar una cuenta"}
      </button>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {open ? (
        <form onSubmit={submit}>
          <label>
            Plataforma
            <select name="platform" required defaultValue="">
              <option value="" disabled>
                Seleccionar
              </option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="messenger">Messenger</option>
              <option value="telegram">Telegram</option>
              <option value="sms">SMS</option>
            </select>
          </label>
          <label>
            Identificador de la cuenta en Zernio
            <input name="externalAccountId" required maxLength={120} placeholder="zernio-acc-1" />
          </label>
          <label>
            Nombre para mostrar
            <input name="displayName" required maxLength={120} placeholder="JDA WhatsApp" />
          </label>
          <label>
            Responsable por defecto (opcional)
            <input name="defaultAssignee" maxLength={120} placeholder="vendedor@jda.test" />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
