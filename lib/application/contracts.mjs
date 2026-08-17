export const APPLICATION_SCHEMA_VERSION = "jda-application.v1";

export const OPERATION_DISCLAIMERS = Object.freeze([
  "Simulación preliminar sujeta a inspección del usado, verificación documental, disponibilidad de la unidad y aprobación crediticia.",
  "Los importes, cuotas y beneficios son orientativos y conservan la vigencia indicada en cada resultado.",
]);

const REASON_MESSAGES = Object.freeze({
  vehicle_unavailable: "La unidad ya no está disponible.",
  vehicle_snapshot_not_current:
    "El precio o el estado del vehículo necesita actualizarse.",
  plan_disabled: "El plan de financiación está deshabilitado.",
  plan_not_current: "El plan de financiación no está vigente.",
  required_promotion_not_applied:
    "La financiación requiere una promoción vigente que no aplica a esta unidad.",
  vehicle_type_not_allowed: "El plan no admite este tipo de vehículo.",
  vehicle_age_not_allowed: "El plan no admite la antigüedad del vehículo.",
  below_minimum_finance_amount:
    "El saldo queda debajo del monto mínimo financiable.",
  above_maximum_finance_amount:
    "El saldo supera el monto máximo financiable.",
  finance_ratio_exceeded:
    "El saldo supera el porcentaje máximo financiable del vehículo.",
  minimum_down_payment_not_met: "No se alcanza el anticipo mínimo requerido.",
  non_financeable_fees_not_covered:
    "El aporte no cubre todos los gastos que deben pagarse al contado.",
  monthly_payment_exceeded: "La cuota estimada supera el máximo indicado.",
  pricing_not_available:
    "El tarifario no contiene una condición para este monto y plazo.",
  no_eligible_financing_plan:
    "No hay un plan vigente que cumpla todas las condiciones.",
});

const STATUS_MESSAGES = Object.freeze({
  reachable_with_margin: "Alcanzable con margen",
  reachable_estimated: "Alcanzable estimado",
  close: "Cerca de alcanzarlo",
  requires_evaluation: "Requiere evaluación",
  unreachable_today: "No alcanzable hoy",
});

export class ApplicationContractError extends Error {
  constructor(code, message, field = null, details = null) {
    super(message);
    this.name = "ApplicationContractError";
    this.code = code;
    this.field = field;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      field: this.field,
      details: this.details,
    };
  }
}

export function explainReasons(reasons) {
  return Object.freeze(
    reasons.map((code) =>
      Object.freeze({
        code,
        message: REASON_MESSAGES[code] ?? "La operación requiere revisión.",
      }),
    ),
  );
}

export function explainStatus(status) {
  return STATUS_MESSAGES[status] ?? "Requiere evaluación";
}

export function toJsonDto(value) {
  if (typeof value === "bigint") {
    const safe = Number(value);
    return Number.isSafeInteger(safe) ? safe : value.toString();
  }
  if (value && typeof value.toJSON === "function") {
    return toJsonDto(value.toJSON());
  }
  if (Array.isArray(value)) {
    return value.map(toJsonDto);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toJsonDto(nested)]),
    );
  }
  return value;
}

export function immutableJsonDto(value) {
  const plain = toJsonDto(value);
  JSON.stringify(plain);
  return deepFreeze(plain);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
