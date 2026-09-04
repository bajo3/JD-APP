"use client";

import { type FormEvent, useState } from "react";

type Review = {
  status: string; version: number; budgetCents: number | null; currency: string;
  desiredMakes: readonly string[]; desiredModels: readonly string[]; acceptedTypes: readonly string[];
  minYear: number | null; maxMileageKm: number | null; tradeInDescription: string | null;
  urgencyDays: number | null; locality: string | null;
};

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
}

export function PassportReviewForm({ token, initial }: { token: string; initial: Review }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initial.status === "CONFIRMED" ? "Esta búsqueda ya fue confirmada." : "");
  const [confirmed, setConfirmed] = useState(initial.status === "CONFIRMED");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const budget = Number(String(data.get("budget") ?? ""));
    if (!Number.isFinite(budget) || budget <= 0) { setMessage("Indicá un presupuesto válido."); return; }
    setBusy(true); setMessage("Guardando tu búsqueda…");
    try {
      const response = await fetch(`/api/v1/passports/${encodeURIComponent(token)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: initial.version, budgetCents: Math.round(budget * 100), currency: data.get("currency"),
          desiredMakes: list(String(data.get("makes") ?? "")), desiredModels: list(String(data.get("models") ?? "")),
          acceptedTypes: list(String(data.get("types") ?? "")),
          minYear: data.get("minYear") ? Number(data.get("minYear")) : null,
          maxMileageKm: data.get("maxMileageKm") ? Number(data.get("maxMileageKm")) : null,
          tradeInDescription: String(data.get("tradeInDescription") ?? "").trim() || null,
          urgencyDays: data.get("urgencyDays") ? Number(data.get("urgencyDays")) : null,
          locality: String(data.get("locality") ?? "").trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? "No pudimos guardar la búsqueda.");
      setConfirmed(true); setMessage("Listo: registramos tu búsqueda. Te avisamos si aparece algo que coincida.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos guardar la búsqueda."); }
    finally { setBusy(false); }
  }
  if (confirmed) return <section className="form-card"><p className="admin-feedback" role="status">{message}</p></section>;
  return <form className="form-card" onSubmit={submit}>
    <label>Presupuesto máximo<input name="budget" type="number" min="1" step="1" required defaultValue={initial.budgetCents ? initial.budgetCents / 100 : ""} /></label>
    <label>Moneda<select name="currency" defaultValue={initial.currency}><option value="ARS">Pesos argentinos (ARS)</option><option value="USD">Dólares estadounidenses (USD)</option></select></label>
    <label>Marcas que buscás<input name="makes" defaultValue={initial.desiredMakes.join(", ")} /></label>
    <label>Modelos que buscás<input name="models" defaultValue={initial.desiredModels.join(", ")} /></label>
    <label>Tipos de vehículo<input name="types" defaultValue={initial.acceptedTypes.join(", ")} /></label>
    <label>Año mínimo<input name="minYear" type="number" min="1950" max="2100" defaultValue={initial.minYear ?? ""} /></label>
    <label>Kilometraje máximo<input name="maxMileageKm" type="number" min="0" max="3000000" defaultValue={initial.maxMileageKm ?? ""} /></label>
    <label>Usado que entregarías (opcional)<textarea name="tradeInDescription" maxLength={200} defaultValue={initial.tradeInDescription ?? ""} /></label>
    <label>En cuántos días te gustaría comprar (opcional)<input name="urgencyDays" type="number" min="0" max="3650" defaultValue={initial.urgencyDays ?? ""} /></label>
    <label>Localidad (opcional)<input name="locality" maxLength={80} defaultValue={initial.locality ?? ""} /></label>
    <p className="panel-muted">La confirmación no reserva una unidad ni garantiza que aparezca una.</p>
    {message ? <p className="admin-feedback" role="status">{message}</p> : null}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : "Confirmar búsqueda"}</button>
  </form>;
}
