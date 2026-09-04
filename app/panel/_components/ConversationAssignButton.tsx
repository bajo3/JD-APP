"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ConversationAssignButton({
  conversationId,
  contactName,
  expectedVersion,
}: {
  conversationId: string;
  contactName: string;
  expectedVersion: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function assignSelf() {
    setBusy(true);
    setMessage("Asignando…");
    try {
      const response = await fetch(`/api/v1/admin/conversations/${conversationId}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign-self", expectedVersion }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "No se pudo asignar la conversación.");
      }
      setMessage("Conversación asignada.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inbox-row-actions">
      <button
        type="button"
        className="panel-action"
        disabled={busy}
        aria-label={`Asignarme esta conversación: ${contactName}`}
        onClick={assignSelf}
      >
        {busy ? "Asignando…" : "Asignarme"}
      </button>
      {message ? <small role="status">{message}</small> : null}
    </div>
  );
}
