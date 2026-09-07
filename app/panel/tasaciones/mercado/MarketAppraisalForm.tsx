"use client";

import { type FormEvent, useState } from "react";

type MarketStatus =
  | "NOT_CONFIGURED"
  | "NEEDS_DETAILS"
  | "INSUFFICIENT_DATA"
  | "PROVIDER_UNAVAILABLE"
  | "STALE"
  | "READY_FOR_REVIEW";

type Comparable = Readonly<{
  sourceItemId: string;
  make: string;
  model: string;
  trim: string;
  year: number | null;
  mileageKm: number | null;
  priceCents: number | null;
  currency: string;
  permalink: string;
}>;

type ApiPayload = Readonly<{
  status?: string;
  message?: string;
  data?: {
    status?: string;
    message?: string;
    comparables?: Comparable[];
    range?: { lowCents: number; baseCents: number; highCents: number; currency: string };
    validUntil?: string;
  };
  error?: { code?: string; message?: string };
}>;

const statusCopy: Record<MarketStatus, { label: string; detail: string; tone: string }> = {
  NOT_CONFIGURED: {
    label: "No configurado",
    detail: "La referencia de mercado todavía no está habilitada en este entorno.",
    tone: "border-[#f2dcb5] bg-[#fff8ed] text-[#80683c]",
  },
  NEEDS_DETAILS: {
    label: "Faltan detalles",
    detail: "Completá versión, combustible, transmisión y región para continuar.",
    tone: "border-[#f2dcb5] bg-[#fff8ed] text-[#80683c]",
  },
  INSUFFICIENT_DATA: {
    label: "Datos insuficientes",
    detail: "No hay comparables suficientes para preparar una referencia revisable.",
    tone: "border-[#f2dcb5] bg-[#fff8ed] text-[#80683c]",
  },
  PROVIDER_UNAVAILABLE: {
    label: "Proveedor no disponible",
    detail: "No se pudo obtener una referencia ahora. Probá nuevamente más tarde.",
    tone: "border-[#efb0d4] bg-[#fff0f7] text-[#7d2a58]",
  },
  STALE: {
    label: "Referencia vencida",
    detail: "La consulta anterior venció y necesita una nueva revisión.",
    tone: "border-[#efb0d4] bg-[#fff0f7] text-[#7d2a58]",
  },
  READY_FOR_REVIEW: {
    label: "Listo para revisión",
    detail: "La referencia quedó disponible para que el equipo la revise.",
    tone: "border-[#bcd8c4] bg-[#f6fbf7] text-[#28613c]",
  },
};

function normalizeStatus(value: unknown): MarketStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[- ]/g, "_");
  if (normalized === "READY" || normalized === "READY_FOR_REVIEW") return "READY_FOR_REVIEW";
  if (normalized === "NOT_CONFIGURED" || normalized === "PROVIDER_NOT_CONFIGURED" || normalized === "MARKET_PROVIDER_NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (normalized === "NEEDS_DETAILS") return normalized;
  if (normalized === "INSUFFICIENT_DATA") return normalized;
  if (normalized === "PROVIDER_UNAVAILABLE" || normalized === "UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (normalized === "STALE") return normalized;
  return null;
}

function money(value: number | undefined, currency = "ARS") {
  if (!Number.isFinite(value)) return "Precio no informado";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value) / 100);
}

export function MarketAppraisalForm() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [message, setMessage] = useState("");
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [marketRange, setMarketRange] = useState<{ min?: number; max?: number; currency?: string } | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const make = String(form.get("make") ?? "").trim();
    const model = String(form.get("model") ?? "").trim();
    const trim = String(form.get("trim") ?? "").trim();
    const fuel = String(form.get("fuel") ?? "").trim();
    const transmission = String(form.get("transmission") ?? "").trim();
    const region = String(form.get("region") ?? "").trim();
    const currency = String(form.get("currency") ?? "").trim();
    const year = Number(form.get("year"));
    const mileageKm = Number(form.get("mileageKm"));
    if (!make || !model || !trim || !fuel || !transmission || !region || !["ARS", "USD"].includes(currency) || !Number.isInteger(year) || !Number.isInteger(mileageKm)) {
      setStatus("NEEDS_DETAILS");
      setMessage(statusCopy.NEEDS_DETAILS.detail);
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/market-appraisals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ make, model, trim, year, mileageKm, fuel, transmission, region, currency }),
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      const nextStatus = normalizeStatus(payload?.data?.status ?? payload?.status ?? payload?.error?.code);
      if (!response.ok) {
        setStatus(nextStatus ?? (response.status === 422 ? "NEEDS_DETAILS" : "PROVIDER_UNAVAILABLE"));
        setMessage(payload?.error?.message ?? payload?.message ?? statusCopy.PROVIDER_UNAVAILABLE.detail);
        return;
      }
      const nextComparables = payload?.data?.comparables ?? [];
      setStatus(nextStatus ?? "INSUFFICIENT_DATA");
      setMessage(payload?.data?.message ?? payload?.message ?? "");
      setComparables(nextComparables);
      setMarketRange(payload?.data?.range ? { min: payload.data.range.lowCents, max: payload.data.range.highCents, currency: payload.data.range.currency } : null);
      setExpiresAt(payload?.data?.validUntil ?? null);
    } catch {
      setStatus("PROVIDER_UNAVAILABLE");
      setMessage(statusCopy.PROVIDER_UNAVAILABLE.detail);
    } finally {
      setBusy(false);
    }
  }

  const copy = status ? statusCopy[status] : null;
  return (
    <div className="mt-6">
      <form onSubmit={submit} className="admin-form-grid">
        <label>Marca<input name="make" required placeholder="Toyota" autoComplete="off" /></label>
        <label>Modelo<input name="model" required placeholder="Corolla" autoComplete="off" /></label>
        <label>Versión<input name="trim" required placeholder="XEI" autoComplete="off" /></label>
        <label>Año<input name="year" type="number" min="1950" max="2100" required placeholder="2021" /></label>
        <label>Kilometraje<input name="mileageKm" type="number" min="0" required placeholder="65000" /></label>
        <label>Combustible<select name="fuel" required defaultValue=""><option value="" disabled>Seleccioná</option><option value="NAFTA">Nafta</option><option value="DIESEL">Diésel</option><option value="HYBRID">Híbrido</option><option value="ELECTRIC">Eléctrico</option></select></label>
        <label>Transmisión<select name="transmission" required defaultValue=""><option value="" disabled>Seleccioná</option><option value="MANUAL">Manual</option><option value="AUTOMATIC">Automática</option></select></label>
        <label>Región<input name="region" required placeholder="Buenos Aires" autoComplete="address-level1" /></label>
        <label>Moneda<select name="currency" required defaultValue="ARS"><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
        <div className="admin-form-wide flex flex-wrap items-center gap-3 pt-1">
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Consultando…" : "Consultar referencia"}<span>→</span></button>
          <span className="panel-muted text-xs">Sólo se consultan referencias de precios publicados.</span>
        </div>
      </form>

      {copy ? <section aria-live="polite" className={`mt-6 rounded-lg border p-4 ${copy.tone}`}>
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em]">Estado</p>
        <h3 className="mt-1 mb-1 text-base font-bold">{copy.label}</h3>
        <p className="m-0 text-sm leading-6">{message || copy.detail}</p>
        {expiresAt ? <p className="mt-2 mb-0 text-xs">Vigencia de esta referencia: {new Date(expiresAt).toLocaleString("es-AR")}</p> : null}
      </section> : null}

      {status === "READY_FOR_REVIEW" && (comparables.length > 0 || marketRange) ? <section className="panel-card mt-5" aria-labelledby="market-comparables-title">
        <div className="panel-card-head"><div><p className="panel-kicker">RESULTADO</p><h2 id="market-comparables-title">Comparables publicados</h2></div></div>
        {marketRange ? <p className="panel-muted mb-4">Rango de referencia publicado: <strong>{money(marketRange.min, marketRange.currency)} – {money(marketRange.max, marketRange.currency)}</strong></p> : null}
        {comparables.length > 0 ? <div className="admin-scroll"><table className="admin-table"><thead><tr><th>Vehículo</th><th>Año</th><th>Kilómetros</th><th>Precio publicado</th></tr></thead><tbody>
          {comparables.map((item) => { const label = [item.make, item.model, item.trim].join(" "); return <tr key={item.sourceItemId}><td><a className="admin-row-link" href={item.permalink} target="_blank" rel="noreferrer">{label} ↗</a></td><td>{item.year ?? "—"}</td><td>{typeof item.mileageKm === "number" ? `${new Intl.NumberFormat("es-AR").format(item.mileageKm)} km` : "—"}</td><td>{money(item.priceCents ?? undefined, item.currency)}</td></tr>; })}
        </tbody></table></div> : null}
        <p className="lead-disclaimer">Estos precios son publicados y pueden cambiar. Revisá manualmente cada comparable antes de usarlo como referencia comercial.</p>
      </section> : null}
    </div>
  );
}
