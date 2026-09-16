"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

type VehicleCard = Readonly<{
  vehicleId: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
  mileageKm: number | null;
  transmission: string | null;
  fuelType: string | null;
  color: string | null;
  availability: "confirmada" | "consultar";
  price: number | null;
  currency: string | null;
  detailUrl: string;
  photos: readonly string[];
}>;

type Message = Readonly<{
  id: string;
  role: "user" | "assistant";
  content: string;
  vehicleCards?: readonly VehicleCard[];
}>;

type ApiPayload = Readonly<{
  data?: {
    reply?: string | null;
    escalated?: boolean;
    vehicleCards?: VehicleCard[];
  };
  error?: { message?: string };
}>;

const STARTERS = [
  "¿Tenés algún Gol Trend?",
  "¿Tenés alguna Amarok?",
  "Busco un auto automático para la familia.",
];

function newId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function safeInternalPath(value: string, kind: "photo" | "detail"): string | null {
  try {
    const url = new URL(value, "https://jd-app.invalid");
    const pattern = kind === "photo"
      ? /^\/api\/v1\/media\/vehicles\/[A-Za-z0-9._:-]+$/
      : /^\/autos\/[A-Za-z0-9._~-]+$/;
    return pattern.test(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
}

function money(value: number | null, currency: string | null): string | null {
  if (value === null || !currency) return null;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return null;
  }
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
        setMessages((current) => [...current, {
          id: newId(),
          role: "assistant",
          content: reply.trim(),
          vehicleCards: payload.data?.vehicleCards ?? [],
        }]);
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
                {message.vehicleCards && message.vehicleCards.length > 0 ? (
                  <div className="advisor-test-vehicle-grid">
                    {message.vehicleCards.map((vehicle) => {
                      const photo = vehicle.photos.map((value) => safeInternalPath(value, "photo")).find(Boolean) ?? null;
                      const detail = safeInternalPath(vehicle.detailUrl, "detail");
                      const formattedPrice = money(vehicle.price, vehicle.currency);
                      return (
                        <article className="advisor-test-vehicle" key={vehicle.vehicleId}>
                          {photo ? <Image unoptimized src={photo} alt={`${vehicle.make} ${vehicle.model} ${vehicle.year}`} width={640} height={360} /> : null}
                          <div>
                            <strong>{vehicle.make} {vehicle.model} {vehicle.trim ?? ""}</strong>
                            <span>{vehicle.year} · {vehicle.mileageKm === null ? "Kilometraje a confirmar" : `${vehicle.mileageKm.toLocaleString("es-AR")} km`}</span>
                            <span>{[vehicle.transmission, vehicle.fuelType, vehicle.color].filter(Boolean).join(" · ")}</span>
                            <b>{formattedPrice ?? "Precio y disponibilidad a confirmar"}</b>
                            {detail ? <a href={detail} target="_blank" rel="noreferrer">Ver ficha y todas las fotos ↗</a> : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
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
