"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type WorkflowAction = "schedule-follow-up" | "clear-follow-up" | "mark-lost";

export function ConversationWorkflowForm({
  conversationId,
  expectedVersion,
  assignedTo,
  followUpAt,
  followUpNote,
  hasLead,
}: {
  conversationId: string;
  expectedVersion: number;
  assignedTo: string | null;
  followUpAt: string | null;
  followUpNote: string | null;
  hasLead: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<WorkflowAction | null>(null);
  const [message, setMessage] = useState("");

  async function mutate(action: WorkflowAction, payload: Record<string, unknown> = {}) {
    setBusy(action);
    setMessage("Guardando…");
    try {
      const response = await fetch(`/api/v1/admin/conversations/${conversationId}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion, ...payload }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "No se pudo guardar el cambio.");
      }
      setMessage(action === "mark-lost" ? "Oportunidad cerrada como perdida." : "Seguimiento actualizado.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(null);
    }
  }

  function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localValue = String(form.get("followUpAt") ?? "").trim();
    const due = new Date(localValue);
    if (!localValue || !Number.isFinite(due.getTime())) {
      setMessage("Elegí una fecha y hora válidas.");
      return;
    }
    void mutate("schedule-follow-up", {
      followUpAt: due.toISOString(),
      note: String(form.get("note") ?? "").trim() || undefined,
    });
  }

  function markLost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 2) {
      setMessage("Explicá por qué se perdió la oportunidad.");
      return;
    }
    if (!window.confirm("¿Confirmás cerrar esta oportunidad como perdida?")) return;
    void mutate("mark-lost", { reason });
  }

  return (
    <section className="panel-card inbox-workflow" aria-labelledby="workflow-title">
      <div className="panel-card-head">
        <div>
          <p className="panel-kicker">SEGUIMIENTO COMERCIAL</p>
          <h2 id="workflow-title">Responsable y próximo contacto</h2>
        </div>
      </div>
      <p className="panel-muted">
        Responsable actual: <strong>{assignedTo ?? "sin asignar"}</strong>.
      </p>
      {followUpAt ? (
        <p className="inbox-follow-up-current">
          Programado para <time dateTime={followUpAt}>{formatDateTime(followUpAt)}</time>
          {followUpNote ? ` · ${followUpNote}` : ""}
        </p>
      ) : null}
      <form onSubmit={schedule}>
        <label>
          Fecha y hora
          <input name="followUpAt" type="datetime-local" required />
        </label>
        <label>
          Nota interna
          <textarea name="note" maxLength={500} rows={2} defaultValue={followUpNote ?? ""} />
        </label>
        <button className="panel-action panel-primary" type="submit" disabled={busy !== null}>
          {busy === "schedule-follow-up" ? "Guardando…" : followUpAt ? "Reprogramar" : "Programar seguimiento"}
        </button>
        {followUpAt ? (
          <button
            className="panel-action"
            type="button"
            disabled={busy !== null}
            onClick={() => void mutate("clear-follow-up")}
          >
            Quitar recordatorio
          </button>
        ) : null}
      </form>
      <p className="panel-muted">Este seguimiento es un recordatorio interno; no envía mensajes automáticamente.</p>
      {hasLead ? (
        <form className="inbox-lost-form" onSubmit={markLost}>
          <label>
            Motivo de pérdida
            <textarea name="reason" required minLength={2} maxLength={500} rows={2} />
          </label>
          <button className="panel-action" type="submit" disabled={busy !== null}>
            {busy === "mark-lost" ? "Cerrando…" : "Marcar como perdida"}
          </button>
        </form>
      ) : (
        <p className="panel-muted">Vinculá un lead antes de registrar una pérdida.</p>
      )}
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
    </section>
  );
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "fecha no informada"
    : new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        dateStyle: "short",
        timeStyle: "short",
      }).format(parsed);
}
