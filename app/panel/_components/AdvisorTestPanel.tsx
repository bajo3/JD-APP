"use client";

import { useMemo, useState } from "react";

type Message = Readonly<{
  id: string;
  role: "user" | "assistant";
  content: string;
}>;

type ApiPayload = Readonly<{
  data?: {
    reply?: string | null;
    escalated?: boolean;
  };
  error?: { message?: string };
}>;

const STARTERS = [
  "Hola, ¿qué autos tienen disponibles?",
  "Busco un auto para trabajar y puedo pagar 40 lucas por mes.",
  "¿Cuánto sale el BMW de la publicación?",
];

function newId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function AdvisorTestPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSend = useMemo(() => draft.trim().length > 0 && !busy, [draft, busy]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || busy) return;
    const nextMessages = [...messages, { id: newId(), role: "user" as const, content }];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/v1/admin/advisor-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })) }),
      });
      const payload = await response.json().catch(() => null) as ApiPayload | null;
      if (!response.ok || typeof payload?.data !== "object" || payload.data === null) {
        throw new Error(payload?.error?.message ?? "No se pudo probar el agente.");
      }
      const reply = payload.data.reply;
      if (typeof reply === "string" && reply.trim()) {
        setMessages((current) => [...current, { id: newId(), role: "assistant", content: reply.trim() }]);
      } else if (payload.data.escalated) {
        setMessages((current) => [...current, {
          id: newId(),
          role: "assistant",
          content: "En producción esto se derivaría a una persona. En modo prueba no se ejecutó ninguna acción.",
        }]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo probar el agente.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  return (
    <div className="advisor-test-panel">
      <div className="advisor-test-notice" role="note">
        <strong>Modo prueba seguro</strong>
        <span>Usa el mismo agente y stock del panel. No envía mensajes, no crea leads, no agenda visitas y no cambia conversaciones.</span>
      </div>

      <div className="advisor-test-thread" aria-live="polite" aria-label="Conversación de prueba">
        {messages.length === 0 ? (
          <div className="advisor-test-empty">
            <strong>Probalo como si fueras un cliente</strong>
            <p>Escribí con tus palabras, corregilo, cambiá de tema o preguntá por el precio de una publicación.</p>
            <div className="advisor-test-starters">
              {STARTERS.map((starter) => (
                <button type="button" className="advisor-test-starter" key={starter} onClick={() => setDraft(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="advisor-test-messages">
            {messages.map((message) => (
              <li className={`advisor-test-message advisor-test-${message.role}`} key={message.id}>
                <small>{message.role === "user" ? "Cliente" : "Agente JD"}</small>
                <p>{message.content}</p>
              </li>
            ))}
            {busy ? <li className="advisor-test-thinking" aria-label="El agente está pensando">Agente JD está escribiendo…</li> : null}
          </ol>
        )}
      </div>

      <form className="advisor-test-composer" onSubmit={onSubmit}>
        <label htmlFor="advisor-test-message">Mensaje de prueba</label>
        <textarea
          id="advisor-test-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ej.: tengo 100 lucas de anticipo y puedo pagar 40 por mes…"
          maxLength={2_000}
          rows={3}
          disabled={busy}
        />
        <div className="advisor-test-composer-actions">
          <span>{draft.length}/2.000</span>
          <div>
            {messages.length > 0 ? <button type="button" className="panel-action" onClick={() => { setMessages([]); setError(""); }} disabled={busy}>Limpiar</button> : null}
            <button type="submit" className="panel-action panel-primary" disabled={!canSend}>{busy ? "Respondiendo…" : "Enviar prueba"}</button>
          </div>
        </div>
      </form>
      {error ? <p className="admin-feedback is-error" role="alert">{error}</p> : null}
    </div>
  );
}
