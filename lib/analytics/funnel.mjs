// Embudo comercial calculado sólo con hechos persistidos.
//
// Cada paso viene de una tabla real: simulaciones confirmadas, operaciones
// que se convirtieron en contacto, handoffs de WhatsApp preparados y leads
// que el equipo movió de estado. Lo que no está persistido no se estima: se
// declara como no medido para que nadie lea un cero como un dato.

export const FUNNEL_STEPS = Object.freeze([
  Object.freeze({
    key: "simulations",
    label: "Operaciones simuladas",
    source: "Simulaciones confirmadas y congeladas.",
  }),
  Object.freeze({
    key: "linkedLeads",
    label: "Con contacto dejado",
    source: "Simulaciones vinculadas a un lead con consentimiento.",
  }),
  Object.freeze({
    key: "handoffs",
    label: "Handoffs de WhatsApp",
    source: "Enlaces de WhatsApp preparados desde una operación.",
  }),
  Object.freeze({
    key: "contacted",
    label: "Contactados por el equipo",
    source: "Leads que el panel movió más allá de NEW.",
  }),
  Object.freeze({
    key: "won",
    label: "Cerrados",
    source: "Leads marcados como ganados en el panel.",
  }),
]);

// Hitos del plan que necesitan telemetría de cliente o registro de venta y
// que todavía ninguna tabla respalda.
export const UNMEASURED = Object.freeze([
  "Impresiones y vistas de unidades",
  "Aperturas reales de WhatsApp",
  "Venta atribuida a la operación",
  "Diferencia entre cuota simulada y cotizada",
]);

function count(value, key) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`funnel.${key} debe ser un entero no negativo`);
  }
  return value;
}

// Percentage of the previous step, one decimal, or null when the previous
// step is zero: a rate over nothing is not zero, it is undefined.
export function conversionRate(current, previous) {
  if (previous <= 0) return null;
  return Math.round((current / previous) * 1000) / 10;
}

export function buildConversionFunnel(counts, window) {
  const values = FUNNEL_STEPS.map((step) => count(counts[step.key] ?? 0, step.key));
  const steps = FUNNEL_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    source: step.source,
    value: values[index],
    // Both rates are explicit: step-to-step shows where the journey leaks,
    // overall shows how much of the demand reached this point.
    fromPrevious: index === 0 ? null : conversionRate(values[index], values[index - 1]),
    fromStart: index === 0 ? null : conversionRate(values[index], values[0]),
  }));
  return Object.freeze({
    steps: Object.freeze(steps.map((step) => Object.freeze(step))),
    unmeasured: UNMEASURED,
    since: window.since,
    until: window.until,
    empty: values[0] === 0,
  });
}
