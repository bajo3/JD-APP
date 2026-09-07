"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "../asesor/advisor.css";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type AdvisorLink = { href: string; label: string };

const SUGGESTIONS = ["¿Qué autos tienen?", "Quiero entregar mi usado", "¿Cómo puedo financiar?"];
const MAX_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_MESSAGES = 20;
const ENDPOINT = "/api/v1/web-advisor";

function contextFor(messages: Message[], next: string): Message[] {
  const candidate = [...messages, { role: "user" as const, content: next }];
  const kept: Message[] = [];
  let total = 0;
  for (let index = candidate.length - 1; index >= 0 && kept.length < MAX_MESSAGES; index -= 1) {
    const item = candidate[index];
    if (total + item.content.length > MAX_CONTEXT_CHARS && kept.length > 0) break;
    kept.unshift(item);
    total += item.content.length;
  }
  while (kept.length > 0 && kept[0].role !== "user") kept.shift();
  return kept;
}

function safeLinks(value: unknown): AdvisorLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const href = "href" in item && typeof item.href === "string" ? item.href : "";
    const label = "label" in item && typeof item.label === "string" ? item.label.trim() : "";
    const valid = href === "/stock" || href === "/que-auto-me-llevo" || href === "/tasar-mi-usado" || href === "/contacto" || /^\/autos\/[^/?#]+$/.test(href);
    return valid && label ? [{ href, label }] : [];
  });
}

function errorFor(response: Response): string {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    return retryAfter ? `Podés volver a intentarlo en unos ${retryAfter} segundos.` : "Estamos recibiendo muchas consultas. Probá de nuevo en un momento.";
  }
  if (response.status === 503) return "El asistente no está disponible por ahora. Podés explorar el stock o escribirnos desde Contacto.";
  return "No pudimos procesar tu consulta. Revisá el mensaje y probá de nuevo.";
}

export function WebAdvisorChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<AdvisorLink[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const retryPayloadRef = useRef<Message[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);

  const send = useCallback(async (text: string, retryPayload?: Message[]) => {
    const content = text.trim();
    if (sendingRef.current || (!retryPayload && !content)) return;
    const replacingPending = !retryPayload && retryPayloadRef.current !== null && messages.at(-1)?.role === "user";
    const payload = retryPayload ?? contextFor(replacingPending ? messages.slice(0, -1) : messages, content);
    if (!payload.length || payload[payload.length - 1].role !== "user") return;
    sendingRef.current = true;
    const requestGeneration = generationRef.current;
    setLoading(true);
    setError("");
    setLinks([]);
    if (!retryPayload) {
      setMessages((current) => replacingPending ? [...current.slice(0, -1), { role: "user", content }] : [...current, { role: "user", content }]);
      retryPayloadRef.current = payload;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        signal: controller.signal,
      });
      if (requestGeneration !== generationRef.current) return;
      if (!response.ok) throw new Error(errorFor(response));
      const body: unknown = await response.json();
      if (requestGeneration !== generationRef.current) return;
      const data = body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" ? body.data : null;
      const reply = data && "reply" in data && typeof data.reply === "string" ? data.reply.trim() : "";
      if (!reply) throw new Error("No pudimos procesar tu consulta. Probá de nuevo.");
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
      setLinks(safeLinks(data && "links" in data ? data.links : []));
      setDraft("");
      retryPayloadRef.current = null;
    } catch (caught) {
      if (requestGeneration !== generationRef.current) return;
      if (controller.signal.aborted) setError("La consulta tardó demasiado. Podés reintentarlo cuando quieras.");
      else setError(caught instanceof Error ? caught.message : "No pudimos procesar tu consulta. Probá de nuevo.");
    } finally {
      window.clearTimeout(timeout);
      if (requestGeneration === generationRef.current) {
        abortRef.current = null;
        sendingRef.current = false;
        setLoading(false);
      }
    }
  }, [messages]);

  const newConversation = () => {
    generationRef.current += 1;
    abortRef.current?.abort();
    sendingRef.current = false;
    retryPayloadRef.current = null;
    setMessages([]);
    setDraft("");
    setLinks([]);
    setError("");
    setLoading(false);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages, loading]);
  useEffect(() => () => { generationRef.current += 1; abortRef.current?.abort(); }, []);

  return (
    <section className="advisor-chat" aria-label="Chat con el asistente virtual">
      <div className="advisor-chat-toolbar">
        <p className="advisor-chat-note">Tu conversación queda sólo en esta ventana.</p>
        <button type="button" className="advisor-new-button" onClick={newConversation} disabled={loading && !messages.length}>Nueva conversación</button>
      </div>
      <div ref={logRef} className="advisor-log" role="log" aria-live="polite" aria-label="Historial de la conversación">
        {messages.length === 0 ? (
          <div className="advisor-welcome">
            <p>Estoy acá para orientarte con lo que necesitás resolver.</p>
            <div className="advisor-suggestions" aria-label="Sugerencias de consulta">
              {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => send(suggestion)} disabled={loading}>{suggestion}</button>)}
            </div>
          </div>
        ) : messages.map((message, index) => (
          <div className={`advisor-message advisor-message-${message.role}`} key={`${message.role}-${index}`}>
            <span className="advisor-message-role">{message.role === "user" ? "Vos" : "Asistente virtual"}</span>
            <p>{message.content}</p>
          </div>
        ))}
        {loading ? <div className="advisor-message advisor-message-assistant advisor-loading" aria-label="Procesando consulta"><span className="advisor-message-role">Asistente virtual</span><p>Estoy revisando tu consulta…</p></div> : null}
      </div>
      {links.length > 0 ? <nav className="advisor-links" aria-label="Enlaces relacionados">{links.map((link) => <Link key={`${link.href}-${link.label}`} href={link.href}>{link.label} <span aria-hidden="true">↗</span></Link>)}</nav> : null}
      <p className="advisor-consent">Tu consulta se procesa con IA. No compartas documentos ni datos sensibles. El chat no se guarda en tu cuenta.</p>
      {error ? <div className="advisor-error" role="alert"><span>{error}</span><button type="button" onClick={() => retryPayloadRef.current && send("", retryPayloadRef.current)} disabled={loading}>Reintentar</button></div> : null}
      <form className="advisor-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <label htmlFor="advisor-message">Escribí tu consulta</label>
        <textarea ref={textareaRef} id="advisor-message" value={draft} maxLength={MAX_CHARS} placeholder="Contame qué estás buscando…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={loading} />
        <div className="advisor-composer-footer"><span>{draft.length}/{MAX_CHARS}</span><button className="primary-button" type="submit" disabled={loading || !draft.trim()}>Enviar <span aria-hidden="true">→</span></button></div>
      </form>
    </section>
  );
}
