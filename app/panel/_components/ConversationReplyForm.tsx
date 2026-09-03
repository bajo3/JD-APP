"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

export function ConversationReplyForm({
  conversationId,
  handling,
}: {
  conversationId: string;
  handling: string;
}) {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setMessage("Enviando…");
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(`/api/v1/admin/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "No se pudo enviar el mensaje.");
      }
      idempotencyKey.current = null;
      setText("");
      setMessage("Mensaje enviado.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHandling(nextHandling: "AI" | "HUMAN") {
    if (nextHandling === handling) return;
    let reason = "";
    if (nextHandling === "HUMAN") {
      reason = window.prompt("¿Por qué pasás la conversación a atención humana?") ?? "";
      if (!reason.trim()) return;
    }
    setBusy(true);
    setMessage(nextHandling === "AI" ? "Pasando al asesor…" : "Pasando a atención humana…");
    try {
      const response = await fetch(`/api/v1/admin/conversations/${conversationId}/handling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handling: nextHandling, reason: reason.trim() || undefined }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "No se pudo cambiar el modo.");
      }
      setMessage("Modo actualizado.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inbox-reply">
      <div className="inbox-handling-switch">
        <button
          type="button"
          className={`panel-action${handling === "HUMAN" ? " panel-primary" : ""}`}
          disabled={busy || handling === "HUMAN"}
          onClick={() => toggleHandling("HUMAN")}
        >
          Atención humana
        </button>
        <button
          type="button"
          className={`panel-action${handling === "AI" ? " panel-primary" : ""}`}
          disabled={busy || handling === "AI"}
          onClick={() => toggleHandling("AI")}
        >
          Pasar al asesor
        </button>
      </div>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      <form onSubmit={submit}>
        <label className="inbox-reply-label" htmlFor="inbox-reply-text">
          Responder
        </label>
        <textarea
          id="inbox-reply-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Escribí la respuesta para el cliente"
          disabled={busy}
        />
        <button className="primary-button" type="submit" disabled={busy || !text.trim()}>
          {busy ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
