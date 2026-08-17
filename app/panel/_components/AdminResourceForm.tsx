"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

type Resource = "vehicle" | "lead" | "appraisal" | "finance" | "promotion";
export type AdminFormRecord = Readonly<{
  id: string;
  label: string;
  status: string;
  version: number;
}>;

export function AdminResourceForm({
  resource,
  records = [],
}: {
  resource: Resource;
  records?: readonly AdminFormRecord[];
}) {
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
      const request = buildRequest(resource, data, records);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (request.method === "POST") {
        idempotencyKey.current ??= crypto.randomUUID();
        headers["Idempotency-Key"] = idempotencyKey.current;
      }
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers,
        body: JSON.stringify(request.payload),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(
          response.status === 409
            ? "El registro cambió. Recargá los datos antes de continuar."
            : payload?.error?.message ?? "No se pudo guardar.",
        );
      }
      idempotencyKey.current = null;
      form.reset();
      setMessage("Guardado correctamente.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-form panel-card">
      <div className="panel-card-head">
        <div><p className="panel-kicker">ACCIÓN OPERATIVA</p><h2>{formTitle(resource)}</h2></div>
        <button className="panel-action panel-primary" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Cerrar" : "Abrir formulario"}
        </button>
      </div>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {open ? (
        <form onSubmit={submit}>
          <div className="admin-form-grid">{formFields(resource, records)}</div>
          <button className="primary-button" disabled={busy} type="submit">{busy ? "Guardando…" : "Guardar"}</button>
        </form>
      ) : null}
    </section>
  );
}

function formFields(resource: Resource, records: readonly AdminFormRecord[]) {
  if (resource === "vehicle") {
    return <>
      <Field name="slug" label="Identificador web" placeholder="toyota-corolla-xei-2022" />
      <Field name="make" label="Marca" /><Field name="model" label="Modelo" /><Field name="trim" label="Versión" />
      <Field name="year" label="Año" type="number" /><Field name="mileageKm" label="Kilómetros" type="number" min="0" />
      <Field name="priceArs" label="Precio publicado (ARS)" type="number" min="1" />
      <Field name="bodyType" label="Carrocería" /><Field name="fuelType" label="Combustible" />
      <Field name="transmission" label="Transmisión" /><Field name="color" label="Color" />
      <Check name="isDemo" label="Guardar como registro DEMO" />
    </>;
  }
  if (resource === "lead") {
    return <>
      <RecordSelect records={records} label="Lead" />
      <label>Próxima etapa<select name="nextStatus" required><option value="">Seleccionar</option><option value="CONTACTED">Contactado</option><option value="QUALIFIED">Calificado</option><option value="WON">Ganado</option><option value="LOST">Perdido</option></select></label>
      <Field name="assignedTo" label="Asignar a" required={false} />
      <Field name="lostReason" label="Motivo de pérdida (obligatorio si se marca Perdido)" required={false} />
    </>;
  }
  if (resource === "appraisal") {
    return <>
      <RecordSelect records={records} label="Tasación" />
      <label>Próximo estado<select name="nextStatus" required><option value="">Seleccionar</option><option value="IN_REVIEW">En revisión</option><option value="ESTIMATED">Estimada</option><option value="APPROVED">Aprobada</option><option value="REJECTED">Rechazada</option><option value="EXPIRED">Vencida</option></select></label>
      <Field name="lowArs" label="Valor conservador (ARS)" type="number" required={false} min="1" />
      <Field name="baseArs" label="Valor base (ARS)" type="number" required={false} min="1" />
      <Field name="highArs" label="Valor favorable (ARS)" type="number" required={false} min="1" />
      <label>Nivel de certeza<select name="certaintyLevel"><option value="">No aplica</option><option value="T0">T0 · Preliminar</option><option value="T1">T1 · Revisada</option></select></label>
      <Field name="validUntil" label="Válida hasta" type="datetime-local" required={false} />
      <Field name="notes" label="Observaciones" required={false} />
    </>;
  }
  if (resource === "finance") {
    return <>
      <Field name="version" label="Código de versión" /><Field name="name" label="Nombre del plan" /><Field name="provider" label="Proveedor" />
      <label>Modalidad<select name="pricingKind" required><option value="">Seleccionar</option><option value="french">Sistema francés</option><option value="coefficient">Coeficiente general</option><option value="table">Tabla de coeficientes</option></select></label>
      <Field name="monthlyRatePercent" label="Tasa mensual (%) · solo sistema francés" type="number" step="0.01" required={false} min="0" />
      <Field name="installmentCoefficientPpm" label="Coeficiente general PPM · solo coeficiente" type="number" required={false} min="1" />
      <Field name="maxFinancePercent" label="Máximo financiable (%)" type="number" step="0.01" min="0" max="100" />
      <Field name="minimumDownPaymentPercent" label="Anticipo mínimo (%)" type="number" step="0.01" min="0" max="100" />
      <Field name="comfortableMarginPercent" label="Margen de cuota cómoda (%)" type="number" step="0.01" min="0" max="100" />
      <Field name="allowedVehicleTypes" label="Tipos admitidos, separados por coma" placeholder="SUV, Sedán" />
      <Field name="maxVehicleAgeYears" label="Antigüedad máxima del vehículo" type="number" min="0" />
      <Field name="validFrom" label="Vigente desde" type="datetime-local" /><Field name="validUntil" label="Vigente hasta" type="datetime-local" />
      <Field name="disclaimer" label="Aclaración comercial obligatoria" />
      <Field name="termMonths" label="Plazo del tramo (meses)" type="number" min="1" />
      <Field name="minAmountArs" label="Monto mínimo del tramo (ARS)" type="number" min="0" />
      <Field name="maxAmountArs" label="Monto máximo del tramo (ARS)" type="number" min="1" />
      <Field name="tierCoefficientPpm" label="Coeficiente PPM del tramo · solo tabla" type="number" required={false} min="1" />
      <Check name="isDemo" label="Guardar como tarifario DEMO" />
    </>;
  }
  return <>
    <Field name="slug" label="Identificador web" placeholder="oferta-jd-del-dia" />
    <Field name="publicCode" label="Código público" /><Field name="title" label="Título" /><Field name="description" label="Descripción" />
    <label>Tipo<select name="type" required><option value="">Seleccionar</option><option value="PRICE_DISCOUNT">Baja de precio</option><option value="TRADE_IN_BONUS">Toma especial</option><option value="FINANCING">Financiación especial</option></select></label>
    <Field name="vehicleIds" label="IDs de vehículos, separados por coma" />
    <Field name="startsAt" label="Comienza" type="datetime-local" /><Field name="endsAt" label="Finaliza" type="datetime-local" />
    <Field name="normalPriceArs" label="Condición normal: precio publicado (ARS)" type="number" min="1" />
    <Field name="discountArs" label="Descuento (ARS)" type="number" min="0" />
    <Field name="tradeInBonusArs" label="Mejora de toma (ARS)" type="number" min="0" />
    <Check name="stackable" label="Acumulable con otra promoción" /><Check name="isDemo" label="Guardar como oferta DEMO" />
  </>;
}

function buildRequest(resource: Resource, form: FormData, records: readonly AdminFormRecord[]) {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  if (resource === "vehicle") {
    return { method: "POST", endpoint: "/api/v1/admin/vehicles", payload: {
      slug: value("slug"), make: value("make"), model: value("model"), trim: value("trim"),
      year: integer(value("year"), "Año"), mileageKm: integer(value("mileageKm"), "Kilómetros"),
      priceCents: cents(value("priceArs"), "Precio"), currency: "ARS", bodyType: value("bodyType"),
      fuelType: value("fuelType"), transmission: value("transmission"), color: value("color"),
      source: form.has("isDemo") ? "DEMO:admin" : "manual", isDemo: form.has("isDemo"),
    } } as const;
  }
  if (resource === "lead" || resource === "appraisal") {
    const record = selectedRecord(value("recordId"), records);
    if (resource === "lead") return { method: "PATCH", endpoint: `/api/v1/admin/leads/${record.id}`, payload: {
      expectedVersion: record.version, nextStatus: value("nextStatus"),
      ...(value("assignedTo") ? { assignedTo: value("assignedTo") } : {}),
      ...(value("lostReason") ? { lostReason: value("lostReason") } : {}),
    } } as const;
    const nextStatus = value("nextStatus");
    return { method: "PATCH", endpoint: `/api/v1/admin/appraisals/${record.id}`, payload: {
      expectedVersion: record.version, nextStatus, currency: "ARS",
      ...(value("lowArs") ? { lowCents: cents(value("lowArs"), "Valor conservador") } : {}),
      ...(value("baseArs") ? { baseCents: cents(value("baseArs"), "Valor base") } : {}),
      ...(value("highArs") ? { highCents: cents(value("highArs"), "Valor favorable") } : {}),
      ...(value("certaintyLevel") ? { certaintyLevel: value("certaintyLevel") } : {}),
      ...(value("validUntil") ? { validUntil: iso(value("validUntil"), "Vigencia") } : {}),
      ...(value("notes") ? { notes: value("notes") } : {}),
    } } as const;
  }
  if (resource === "finance") {
    const tierCoefficient = optionalInteger(value("tierCoefficientPpm"), "Coeficiente del tramo");
    return { method: "POST", endpoint: "/api/v1/admin/finance-plans", payload: {
      version: value("version"), name: value("name"), provider: value("provider"), currency: "ARS",
      pricingKind: value("pricingKind"), monthlyRateBps: optionalPercentBps(value("monthlyRatePercent"), "Tasa mensual"),
      installmentCoefficientPpm: optionalInteger(value("installmentCoefficientPpm"), "Coeficiente general"),
      maxFinanceRatioBps: percentBps(value("maxFinancePercent"), "Máximo financiable"),
      minimumDownPaymentRatioBps: percentBps(value("minimumDownPaymentPercent"), "Anticipo mínimo"),
      allowedVehicleTypes: value("allowedVehicleTypes").split(",").map((item) => item.trim()).filter(Boolean),
      maxVehicleAgeYears: integer(value("maxVehicleAgeYears"), "Antigüedad máxima"),
      comfortablePaymentMarginBps: percentBps(value("comfortableMarginPercent"), "Margen cómodo"),
      validFrom: iso(value("validFrom"), "Inicio"), validUntil: iso(value("validUntil"), "Fin"),
      disclaimer: value("disclaimer"), tiers: [{ termMonths: integer(value("termMonths"), "Plazo"),
        minAmountCents: cents(value("minAmountArs"), "Monto mínimo", true), maxAmountCents: cents(value("maxAmountArs"), "Monto máximo"),
        installmentCoefficientPpm: tierCoefficient, sortOrder: 0 }], isDemo: form.has("isDemo"),
    } } as const;
  }
  const normalPriceCents = cents(value("normalPriceArs"), "Precio normal");
  return { method: "POST", endpoint: "/api/v1/admin/promotions", payload: {
    slug: value("slug"), publicCode: value("publicCode"), title: value("title"), description: value("description"),
    type: value("type"), vehicleIds: value("vehicleIds").split(",").map((item) => item.trim()).filter(Boolean),
    startsAt: iso(value("startsAt"), "Inicio"), endsAt: iso(value("endsAt"), "Fin"),
    discountCents: cents(value("discountArs"), "Descuento", true),
    tradeInBonusCents: cents(value("tradeInBonusArs"), "Mejora de toma", true),
    stackable: form.has("stackable"), normalConditionsSnapshot: { normalPriceCents, source: "PANEL_ADMIN" },
    isDemo: form.has("isDemo"),
  } } as const;
}

function selectedRecord(id: string, records: readonly AdminFormRecord[]): AdminFormRecord {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Elegí un registro válido.");
  return record;
}

function integer(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label}: ingresá un número entero válido.`);
  return parsed;
}

function optionalInteger(value: string, label: string): number | null {
  return value === "" ? null : integer(value, label);
}

function cents(value: string, label: string, allowZero = false): number {
  const pesos = Number(value);
  const result = Math.round(pesos * 100);
  if (!Number.isFinite(pesos) || !Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) {
    throw new Error(`${label}: ingresá un importe válido en pesos.`);
  }
  return result;
}

function percentBps(value: string, label: string): number {
  const percent = Number(value);
  const result = Math.round(percent * 100);
  if (!Number.isFinite(percent) || !Number.isSafeInteger(result) || result < 0 || result > 10_000) {
    throw new Error(`${label}: ingresá un porcentaje entre 0 y 100.`);
  }
  return result;
}

function optionalPercentBps(value: string, label: string): number | null {
  return value === "" ? null : percentBps(value, label);
}

function iso(value: string, label: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`${label}: elegí una fecha válida.`);
  return date.toISOString();
}

function formTitle(resource: Resource): string {
  return ({ vehicle: "Alta de vehículo", lead: "Actualizar etapa de un lead", appraisal: "Revisar una tasación", finance: "Crear versión de tarifario", promotion: "Crear Oferta JD" })[resource];
}

function RecordSelect({ records, label }: { records: readonly AdminFormRecord[]; label: string }) {
  return <label>{label}<select name="recordId" required><option value="">Seleccionar</option>{records.map((record) => <option key={record.id} value={record.id}>{record.label} · {record.status}</option>)}</select></label>;
}

function Field({ name, label, required = true, ...input }: { name: string; label: string; required?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "required">) {
  return <label>{label}<input {...input} name={name} required={required} /></label>;
}

function Check({ name, label }: { name: string; label: string }) {
  return <label className="admin-check"><input name={name} type="checkbox" /> {label}</label>;
}
