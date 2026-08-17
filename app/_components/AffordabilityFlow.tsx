"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { FinderVehicleContext } from "@/lib/server/finder-context";

type MoneyDto = { currency: "ARS"; minorUnits: number };
type ReasonDetail = { code: string; message: string };
type Evaluation = {
  status: string;
  validUntil: string;
  reasons: string[];
  breakdown: {
    listedPrice: MoneyDto;
    effectivePrice: MoneyDto;
    appraisalApplied: MoneyDto;
    cashUsed: MoneyDto;
    principal: MoneyDto;
    installment: MoneyDto | null;
    termMonths: number | null;
  };
};
type AffordabilityResult = {
  vehicle: {
    id: string;
    slug: string;
    brand: string;
    model: string;
    year: number;
    type: string;
    available: boolean;
  };
  status: string;
  statusLabel: string;
  reasonDetails: ReasonDetail[];
  selectionVersion: string;
  evaluation: Evaluation;
};
type AffordabilityData = {
  evaluatedAt: string;
  rulesetVersion: string;
  disclaimers: string[];
  simulationInput: ApiRecord;
  results: AffordabilityResult[];
};
type SimulationData = {
  code: string;
  status: string;
  classification: string;
  expiresAt: string;
};
type LeadData = { id: string; status: string };
type HandoffData = {
  code: string;
  url: string;
  leadId: string;
  simulationCode: string | null;
};
type FlowStep = "criteria" | "results" | "contact" | "complete" | "fallback" | "stale";
type ApiRecord = Record<string, unknown>;
type ApiEnvelope<T> = { data: T; meta?: ApiRecord };

const ELIGIBLE_STATUSES = new Set([
  "reachable_with_margin",
  "reachable_estimated",
  "close",
]);
const DEFAULT_TERMS = [12, 18, 24, 36];

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function AffordabilityFlow({
  contactPhone,
  demo = false,
  initialVehicle = null,
}: {
  contactPhone: string;
  demo?: boolean;
  initialVehicle?: FinderVehicleContext | null;
}) {
  const [step, setStep] = useState<FlowStep>("criteria");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hasTradeIn, setHasTradeIn] = useState(true);
  const [appraisalMode, setAppraisalMode] = useState<"value" | "range">("value");
  const [tradeValue, setTradeValue] = useState("");
  const [tradeLow, setTradeLow] = useState("");
  const [tradeBase, setTradeBase] = useState("");
  const [tradeHigh, setTradeHigh] = useState("");
  const [cash, setCash] = useState("");
  const [monthly, setMonthly] = useState("");
  const [terms, setTerms] = useState<number[]>([12, 18, 24]);
  const [searchData, setSearchData] = useState<AffordabilityData | null>(null);
  const [selected, setSelected] = useState<AffordabilityResult | null>(null);
  const [simulation, setSimulation] = useState<SimulationData | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [lead, setLead] = useState<LeadData | null>(null);
  const [handoff, setHandoff] = useState<HandoffData | null>(null);
  const actionKeys = useRef<Record<string, string>>({});

  const criteria = buildCriteria({
    hasTradeIn,
    appraisalMode,
    tradeValue,
    tradeLow,
    tradeBase,
    tradeHigh,
    cash,
    monthly,
    terms,
  });

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (criteria.error) {
      setError(criteria.error);
      return;
    }
    setBusyAction("search");
    try {
      const response = await postJson<ApiEnvelope<AffordabilityData>>(
        "/api/v1/affordability/search",
        criteria.searchPayload,
        keyFor(actionKeys.current, "search"),
      );
      setSearchData(response.data);
      setSelected(null);
      setSimulation(null);
      setLead(null);
      setHandoff(null);
      setStep("results");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction(null);
    }
  }

  async function chooseResult(result: AffordabilityResult) {
    setError("");
    if (!ELIGIBLE_STATUSES.has(result.status)) return;
    if (!searchData) {
      setError("La búsqueda ya no está disponible. Volvé a calcular la operación.");
      return;
    }
    if (
      Date.parse(result.evaluation.validUntil) <= Date.parse(searchData.evaluatedAt)
    ) {
      setSelected(result);
      setStep("stale");
      return;
    }
    setBusyAction(`simulation:${result.vehicle.id}`);
    try {
      const response = await postJson<ApiEnvelope<SimulationData>>(
        "/api/v1/simulations",
        {
          vehicleId: result.vehicle.id,
          vehicleSlug: result.vehicle.slug,
          selectionVersion: result.selectionVersion,
          simulationInput: searchData.simulationInput,
        },
        keyFor(actionKeys.current, `simulation:${result.vehicle.id}`),
      );
      setSelected(result);
      setSimulation(response.data);
      setStep("contact");
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        ["OPERATION_CHANGED", "VEHICLE_PRICE_EXPIRED", "VEHICLE_NOT_FOUND"].includes(caught.code)
      ) {
        setSelected(result);
        setStep("stale");
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function completeContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!simulation || !selected) {
      setError("La simulación ya no está disponible. Volvé a calcular la operación.");
      return;
    }
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 8 || !consent) {
      setError("Completá nombre, teléfono y consentimiento para continuar.");
      return;
    }
    setBusyAction("contact");
    try {
      let currentLead = lead;
      if (!currentLead) {
        const leadResponse = await postJson<ApiEnvelope<LeadData>>(
          "/api/v1/leads",
          {
            name: name.trim(),
            phone: phone.trim(),
            contactConsent: true,
            privacyPolicyVersion: "v1",
            source: "AFFORDABILITY_WEB",
            simulationCode: simulation.code,
            vehicleSlug: selected.vehicle.slug,
          },
          keyFor(actionKeys.current, "lead"),
        );
        currentLead = leadResponse.data;
        setLead(currentLead);
      }

      try {
        const handoffResponse = await postJson<ApiEnvelope<HandoffData>>(
          "/api/v1/whatsapp/handoffs",
          {
            leadId: currentLead.id,
            simulationCode: simulation.code,
            vehicleSlug: selected.vehicle.slug,
            source: "AFFORDABILITY_WEB",
          },
          keyFor(actionKeys.current, "handoff"),
        );
        setHandoff(handoffResponse.data);
        setStep("complete");
      } catch (caught) {
        if (caught instanceof ApiRequestError && caught.code === "WHATSAPP_NOT_CONFIGURED") {
          setStep("fallback");
        } else {
          throw caught;
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction(null);
    }
  }

  function restart() {
    actionKeys.current = {};
    setSearchData(null);
    setSelected(null);
    setSimulation(null);
    setLead(null);
    setHandoff(null);
    setError("");
    setStep("criteria");
  }

  function invalidateSearch() {
    delete actionKeys.current.search;
  }

  const displayedResults = searchData
    ? prioritizeContextualResult(searchData.results, initialVehicle)
    : [];
  const contextualResult = initialVehicle && searchData
    ? searchData.results.find((result) => isContextualResult(result, initialVehicle)) ?? null
    : null;
  const contextualResultEligible = contextualResult
    ? ELIGIBLE_STATUSES.has(contextualResult.status)
    : false;

  return (
    <section className="affordability-flow" aria-labelledby="affordability-flow-title">
      <div className="affordability-steps" aria-label="Progreso">
        <span className={step === "criteria" ? "active" : "done"}>01 Tu operación</span>
        <span className={step === "results" || step === "stale" ? "active" : selected ? "done" : ""}>02 Opciones</span>
        <span className={step === "contact" ? "active" : lead ? "done" : ""}>03 Contacto</span>
      </div>

      {initialVehicle && (step === "criteria" || step === "results") ? (
        <aside className="finder-context" aria-label="Vehículo elegido para la simulación">
          <span>ESTÁS CALCULANDO</span>
          <strong>{initialVehicle.name}</strong>
          <Link href="/que-auto-me-llevo">Quitar selección</Link>
        </aside>
      ) : null}

      {step === "criteria" ? (
        <form className="affordability-form" onSubmit={search}>
          <div>
            <p className="eyebrow">CÁLCULO PRELIMINAR</p>
            <h2 id="affordability-flow-title">Contanos con qué contás</h2>
            <p className="affordability-note">No necesitás dejar tus datos personales para explorar.</p>
          </div>

          <label className="affordability-check">
            <input
              type="checkbox"
              checked={hasTradeIn}
              onChange={(event) => { setHasTradeIn(event.target.checked); invalidateSearch(); }}
            />
            Tengo un usado para entregar
          </label>

          {hasTradeIn ? (
            <fieldset className="affordability-fieldset">
              <legend>Valor estimado del usado</legend>
              <div className="affordability-toggle" role="group" aria-label="Forma de ingresar la tasación">
                <button type="button" className={appraisalMode === "value" ? "active" : ""} onClick={() => { setAppraisalMode("value"); invalidateSearch(); }}>Un valor</button>
                <button type="button" className={appraisalMode === "range" ? "active" : ""} onClick={() => { setAppraisalMode("range"); invalidateSearch(); }}>Un rango</button>
              </div>
              {appraisalMode === "value" ? (
                <MoneyField label="Valor aproximado" value={tradeValue} onChange={(value) => { setTradeValue(value); invalidateSearch(); }} placeholder="Ej. 15.000.000" />
              ) : (
                <div className="affordability-grid three">
                  <MoneyField label="Conservador" value={tradeLow} onChange={(value) => { setTradeLow(value); invalidateSearch(); }} placeholder="14.000.000" />
                  <MoneyField label="Probable" value={tradeBase} onChange={(value) => { setTradeBase(value); invalidateSearch(); }} placeholder="15.000.000" />
                  <MoneyField label="Favorable" value={tradeHigh} onChange={(value) => { setTradeHigh(value); invalidateSearch(); }} placeholder="16.000.000" />
                </div>
              )}
              <small>Es una declaración orientativa, no una tasación final.</small>
            </fieldset>
          ) : null}

          <div className="affordability-grid">
            <MoneyField label="Efectivo disponible" value={cash} onChange={(value) => { setCash(value); invalidateSearch(); }} placeholder="Ej. 4.000.000" />
            <MoneyField label="Cuota mensual máxima" value={monthly} onChange={(value) => { setMonthly(value); invalidateSearch(); }} placeholder="Ej. 1.200.000" />
          </div>

          <fieldset className="affordability-fieldset">
            <legend>Plazos que aceptarías</legend>
            <div className="affordability-terms">
              {DEFAULT_TERMS.map((term) => (
                <label key={term}>
                  <input
                    type="checkbox"
                    checked={terms.includes(term)}
                    onChange={() => {
                      setTerms((current) =>
                        current.includes(term)
                          ? current.filter((value) => value !== term)
                          : [...current, term].sort((left, right) => left - right),
                      );
                      invalidateSearch();
                    }}
                  />
                  {term} meses
                </label>
              ))}
            </div>
          </fieldset>

          {demo ? <p className="affordability-demo">Estás viendo datos de demostración.</p> : null}
          <FlowError message={error} />
          <button className="primary-button" disabled={busyAction !== null}>
            {busyAction === "search" ? "Calculando…" : "Ver qué autos puedo llevar"}<span>→</span>
          </button>
          <p className="finder-disclaimer">Resultado preliminar sujeto a inspección del usado, disponibilidad, documentación y evaluación crediticia.</p>
        </form>
      ) : null}

      {step === "results" && searchData ? (
        <div className="affordability-results">
          <div className="affordability-heading-row">
            <div><p className="eyebrow">RESULTADOS PRELIMINARES</p><h2 id="affordability-flow-title">Estas son tus opciones</h2></div>
            <button type="button" className="affordability-link" onClick={restart}>Cambiar datos</button>
          </div>
          <p className="affordability-note">Los resultados se ordenan por accesibilidad; ninguna opción implica aprobación financiera.</p>
          {initialVehicle && contextualResult ? (
            <p className={`finder-context-message ${contextualResultEligible ? "is-eligible" : "is-unavailable"}`} role="status">
              {contextualResultEligible
                ? `${initialVehicle.name} aparece primero porque es la unidad que elegiste.`
                : `${initialVehicle.name} no entra con estos datos. Te mostramos alternativas sin cambiar tus condiciones.`}
            </p>
          ) : null}
          {initialVehicle && !contextualResult ? (
            <p className="finder-context-message is-unavailable" role="status">
              La unidad que elegiste ya no aparece entre las opciones vigentes. Te mostramos alternativas disponibles.
            </p>
          ) : null}
          <div className="affordability-result-list">
            {displayedResults.map((result) => {
              const eligible = ELIGIBLE_STATUSES.has(result.status);
              const contextual = isContextualResult(result, initialVehicle);
              const stale =
                Date.parse(result.evaluation.validUntil) <=
                Date.parse(searchData.evaluatedAt);
              const breakdown = result.evaluation.breakdown;
              return (
                <article className={`affordability-result${contextual ? " is-contextual" : ""}`} key={result.vehicle.id}>
                  <div>
                    <div className="affordability-result-badges">
                      {contextual ? <span className="finder-context-badge">El que elegiste</span> : null}
                      <span className={`affordability-status status-${result.status}`}>{result.statusLabel}</span>
                    </div>
                    <h3>{result.vehicle.brand} {result.vehicle.model}</h3>
                    <p>{result.vehicle.year} · {result.vehicle.type.toUpperCase()}</p>
                  </div>
                  <dl>
                    <div><dt>Precio</dt><dd>{formatMoney(breakdown.effectivePrice)}</dd></div>
                    <div><dt>Saldo estimado</dt><dd>{formatMoney(breakdown.principal)}</dd></div>
                    <div><dt>Cuota estimada</dt><dd>{breakdown.installment ? `${formatMoney(breakdown.installment)} · ${breakdown.termMonths} meses` : "Sin financiación"}</dd></div>
                  </dl>
                  {result.reasonDetails.length > 0 ? (
                    <ul>{result.reasonDetails.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>
                  ) : null}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!eligible || stale || busyAction !== null}
                    onClick={() => void chooseResult(result)}
                  >
                    {busyAction === `simulation:${result.vehicle.id}` ? "Guardando operación…" : stale ? "Condiciones vencidas" : eligible ? "Elegir esta opción" : "No disponible con estos datos"}
                    {eligible && !stale ? <span>→</span> : null}
                  </button>
                </article>
              );
            })}
          </div>
          {searchData.results.length === 0 ? <p>No encontramos opciones con estas condiciones. Probá ajustar efectivo, cuota o plazos.</p> : null}
          <FlowError message={error} />
          <p className="finder-disclaimer">{searchData.disclaimers.join(" ")}</p>
        </div>
      ) : null}

      {step === "contact" && selected && simulation ? (
        <form className="affordability-form" onSubmit={completeContact}>
          <div><p className="eyebrow">OPERACIÓN GUARDADA</p><h2 id="affordability-flow-title">¿Dónde te contactamos?</h2></div>
          <div className="affordability-summary">
            <strong>{selected.vehicle.brand} {selected.vehicle.model} {selected.vehicle.year}</strong>
            <span>Código preliminar: {simulation.code}</span>
          </div>
          <label>Nombre y apellido<input value={name} disabled={Boolean(lead)} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Ej. Martín González" /></label>
          <label>Teléfono / WhatsApp<input value={phone} disabled={Boolean(lead)} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="249 458-7046" /></label>
          <label className="affordability-check">
            <input type="checkbox" checked={consent} disabled={Boolean(lead)} onChange={(event) => setConsent(event.target.checked)} />
            Acepto que Jesús Díaz Automotores me contacte por teléfono o WhatsApp sobre esta operación.
          </label>
          {lead ? <p className="affordability-note">Contacto guardado. Reintentá el envío a WhatsApp sin volver a cargar tus datos.</p> : null}
          <FlowError message={error} />
          <button className="primary-button" disabled={busyAction !== null}>
            {busyAction === "contact" ? "Guardando y preparando WhatsApp…" : lead ? "Reintentar WhatsApp" : "Guardar y continuar a WhatsApp"}<span>→</span>
          </button>
          <p className="finder-disclaimer">La simulación es preliminar y no representa aprobación crediticia ni tasación definitiva.</p>
        </form>
      ) : null}

      {step === "complete" && simulation && selected && handoff ? (
        <div className="form-success affordability-finish" aria-live="polite">
          <span>✓</span><h2 id="affordability-flow-title">Tu operación quedó guardada</h2>
          <p>{selected.vehicle.brand} {selected.vehicle.model} · Código <strong>{simulation.code}</strong></p>
          <a className="primary-button" href={handoff.url} target="_blank" rel="noreferrer">Abrir WhatsApp <span>↗</span></a>
          <p className="finder-disclaimer">Conservá el código. Las condiciones son preliminares y se verifican con un asesor.</p>
        </div>
      ) : null}

      {step === "fallback" && simulation && selected ? (
        <div className="form-success affordability-finish" aria-live="polite">
          <span>✓</span><h2 id="affordability-flow-title">Tu operación quedó guardada</h2>
          <p>WhatsApp todavía no está configurado, pero no perdiste la simulación de {selected.vehicle.brand} {selected.vehicle.model}.</p>
          <p>Código: <strong>{simulation.code}</strong></p>
          <a href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>Llamanos al {contactPhone}</a>
          <p className="finder-disclaimer">Indicá el código al comunicarte. La operación sigue siendo preliminar y sujeta a verificación.</p>
        </div>
      ) : null}

      {step === "stale" ? (
        <div className="form-success affordability-finish" role="status">
          <span>!</span><h2 id="affordability-flow-title">Las condiciones cambiaron</h2>
          <p>El stock, el precio o la vigencia de esta opción necesitan actualizarse antes de guardar la operación.</p>
          <button type="button" className="primary-button" onClick={restart}>Recalcular con mis datos <span>→</span></button>
        </div>
      ) : null}
    </section>
  );
}

function prioritizeContextualResult(
  results: AffordabilityResult[],
  initialVehicle: FinderVehicleContext | null,
): AffordabilityResult[] {
  if (!initialVehicle) return results;
  const index = results.findIndex((result) => isContextualResult(result, initialVehicle));
  if (index <= 0) return results;
  return [results[index], ...results.slice(0, index), ...results.slice(index + 1)];
}

function isContextualResult(
  result: AffordabilityResult,
  initialVehicle: FinderVehicleContext | null,
): boolean {
  return Boolean(
    initialVehicle &&
    result.vehicle.id === initialVehicle.id &&
    result.vehicle.slug === initialVehicle.slug,
  );
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} inputMode="numeric" placeholder={placeholder} /><small>Pesos, sin centavos</small></label>
  );
}

function FlowError({ message }: { message: string }) {
  return message ? <p className="form-error" role="alert">{message}</p> : null;
}

function buildCriteria(input: {
  hasTradeIn: boolean;
  appraisalMode: "value" | "range";
  tradeValue: string;
  tradeLow: string;
  tradeBase: string;
  tradeHigh: string;
  cash: string;
  monthly: string;
  terms: number[];
}) {
  const cashCents = arsInputToCents(input.cash);
  const monthlyCents = arsInputToCents(input.monthly);
  if (cashCents === null || monthlyCents === null || monthlyCents <= 0) {
    return { error: "Ingresá efectivo y una cuota máxima válidos en pesos.", cashCents: 0, monthlyCents: 0, appraisal: null, searchPayload: {} };
  }
  if (input.terms.length === 0) {
    return { error: "Elegí al menos un plazo para calcular.", cashCents, monthlyCents, appraisal: null, searchPayload: {} };
  }

  let appraisal: ApiRecord | null = null;
  if (input.hasTradeIn) {
    const values = input.appraisalMode === "value"
      ? [arsInputToCents(input.tradeValue), arsInputToCents(input.tradeValue), arsInputToCents(input.tradeValue)]
      : [arsInputToCents(input.tradeLow), arsInputToCents(input.tradeBase), arsInputToCents(input.tradeHigh)];
    if (values.some((value) => value === null || value <= 0)) {
      return { error: "Ingresá un valor válido para el usado.", cashCents, monthlyCents, appraisal: null, searchPayload: {} };
    }
    const [low, base, high] = values as [number, number, number];
    if (low > base || base > high) {
      return { error: "El rango del usado debe ir de conservador a favorable.", cashCents, monthlyCents, appraisal: null, searchPayload: {} };
    }
    appraisal = { lowCents: low, baseCents: base, highCents: high, certainty: "T0", requiresReview: false };
  }
  return {
    error: "",
    cashCents,
    monthlyCents,
    appraisal,
    searchPayload: {
      cashCents,
      accreditedDepositCents: 0,
      maxMonthlyPaymentCents: monthlyCents,
      acceptedTerms: input.terms,
      ...(appraisal ? { appraisal } : {}),
    },
  };
}

function arsInputToCents(value: string): number | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return value.trim() === "" ? 0 : null;
  const pesos = Number(digits);
  const cents = pesos * 100;
  return Number.isSafeInteger(cents) ? cents : null;
}

function keyFor(keys: Record<string, string>, action: string): string {
  if (!keys[action]) keys[action] = `affordability:${action}:${crypto.randomUUID()}`;
  return keys[action];
}

async function postJson<T>(path: string, payload: object, idempotencyKey: string): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiRecord;
  if (!response.ok) {
    const failure = body.error && typeof body.error === "object" ? body.error as ApiRecord : {};
    throw new ApiRequestError(
      response.status,
      typeof failure.code === "string" ? failure.code : "REQUEST_FAILED",
      typeof failure.message === "string" ? failure.message : "No pudimos completar la operación.",
      failure.fields && typeof failure.fields === "object" ? failure.fields as Record<string, string> : {},
    );
  }
  return body as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "No pudimos completar la operación. Intentá nuevamente.";
}

function formatMoney(value: MoneyDto): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value.minorUnits / 100);
}
