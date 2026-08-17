import {
  CRM_SCHEMA_VERSION,
  CrmContractError,
  immutableJson,
  isoInstant,
  optionalSafeInteger,
  requiredSafeInteger,
  requiredText,
  toJsonSafe,
} from "./contracts.mjs";
import { validateContextualConversion } from "./context.mjs";

const SELLER_EVENT_METADATA_KEYS = new Set([
  "channel",
  "from",
  "handoffCode",
  "mode",
  "reason",
  "simulationId",
  "source",
  "status",
  "to",
  "vehicleId",
]);

/**
 * Builds the protected seller view exclusively from persisted records. The
 * only derived commercial field is validity against the supplied server clock.
 */
export function buildSellerLeadDetailDto({
  lead,
  simulation,
  vehicle,
  events = [],
  now = new Date(),
}) {
  if (!lead || typeof lead !== "object") invalid("No encontramos el contacto almacenado.", "lead");
  const leadId = requiredText(lead.id, "lead.id", { max: 80 });
  const generatedAt = isoInstant(now, "now");
  const hasSimulation = simulation !== null && simulation !== undefined;
  const hasVehicle = vehicle !== null && vehicle !== undefined;
  if (hasSimulation !== hasVehicle) {
    invalid(
      "El contexto del contacto contiene una simulación o unidad incompleta.",
      hasSimulation ? "vehicle" : "simulation",
    );
  }

  const dto = {
    schemaVersion: `${CRM_SCHEMA_VERSION}.seller-lead-detail.v1`,
    id: leadId,
    name: requiredText(lead.name, "lead.name", { min: 2, max: 120 }),
    phone: requiredText(lead.phoneNormalized, "lead.phoneNormalized", { min: 8, max: 40 }),
    source: requiredText(lead.source, "lead.source", { max: 64 }),
    status: requiredText(lead.status, "lead.status", { max: 30 }),
    createdAt: isoInstant(lead.createdAt, "lead.createdAt"),
    updatedAt: isoInstant(lead.updatedAt, "lead.updatedAt"),
    operation: hasSimulation
      ? sellerOperation({ leadId, simulation, vehicle, generatedAt })
      : null,
    events: sellerEvents(events),
    generatedAt,
  };
  return immutableJson(dto);
}

function sellerOperation({ leadId, simulation, vehicle, generatedAt }) {
  const link = validateContextualConversion({
    leadId,
    simulationCode: simulation.publicCode,
    vehicleSlug: vehicle.slug,
    simulation,
    vehicle,
  });
  const createdAt = isoInstant(simulation.createdAt, "simulation.createdAt");
  const expiresAt = isoInstant(simulation.expiresAt, "simulation.expiresAt");
  const make = requiredText(vehicle.make, "vehicle.make", { max: 60 });
  const model = requiredText(vehicle.model, "vehicle.model", { max: 80 });
  const trim = vehicle.trim === null || vehicle.trim === undefined || vehicle.trim === ""
    ? null
    : requiredText(vehicle.trim, "vehicle.trim", { max: 80 });
  const year = requiredSafeInteger(vehicle.year, "vehicle.year", { min: 1950, max: 3000 });
  return {
    simulationCode: link.simulationCode,
    vehicle: {
      id: link.vehicleId,
      slug: link.vehicleSlug,
      label: [make, model, trim, String(year)].filter(Boolean).join(" "),
      make,
      model,
      trim,
      year,
    },
    status: requiredText(simulation.status, "simulation.status", { max: 30 }),
    classification: requiredText(simulation.classification, "simulation.classification", { max: 60 }),
    certaintyLevel: requiredText(simulation.certaintyLevel, "simulation.certaintyLevel", { max: 30 }),
    amounts: {
      currency: requiredText(simulation.currency, "simulation.currency", { min: 3, max: 3 }).toUpperCase(),
      listedPriceCents: money(simulation.vehiclePriceCents, "simulation.vehiclePriceCents"),
      effectivePriceCents: money(simulation.effectivePriceCents, "simulation.effectivePriceCents"),
      appraisalAppliedCents: money(simulation.appraisalAppliedCents, "simulation.appraisalAppliedCents"),
      tradeInBonusCents: money(simulation.tradeInBonusCents, "simulation.tradeInBonusCents"),
      cashCents: money(simulation.cashCents, "simulation.cashCents"),
      financePrincipalCents: money(simulation.financePrincipalCents, "simulation.financePrincipalCents"),
      installmentCents: optionalMoney(simulation.installmentCents, "simulation.installmentCents"),
      totalCostCents: optionalMoney(simulation.totalCostCents, "simulation.totalCostCents"),
    },
    termMonths: optionalSafeInteger(simulation.termMonths, "simulation.termMonths", { min: 1, max: 600 }),
    createdAt,
    expiresAt,
    validity: Date.parse(expiresAt) <= Date.parse(generatedAt) ? "EXPIRED" : "ACTIVE",
    disclaimer: requiredText(simulation.disclaimerSnapshot, "simulation.disclaimerSnapshot", { min: 1, max: 4_000 }),
  };
}

function sellerEvents(events) {
  if (!Array.isArray(events)) invalid("Los eventos del contacto no son válidos.", "events");
  return events
    .map((event, index) => {
      if (!event || typeof event !== "object") invalid("Un evento del contacto no es válido.", `events.${index}`);
      let metadata = event.metadata ?? null;
      if (metadata === null && typeof event.metadataJson === "string") {
        try {
          metadata = JSON.parse(event.metadataJson);
        } catch {
          invalid("Un evento contiene metadata JSON inválida.", `events.${index}.metadataJson`);
        }
      }
      if (metadata === null) metadata = {};
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        invalid("La metadata de un evento debe ser un objeto.", `events.${index}.metadata`);
      }
      return {
        id: requiredText(event.id, `events.${index}.id`, { max: 100 }),
        type: requiredText(event.type, `events.${index}.type`, { max: 80 }),
        occurredAt: isoInstant(event.occurredAt, `events.${index}.occurredAt`),
        actorType: requiredText(event.actorType ?? "SYSTEM", `events.${index}.actorType`, { max: 30 }),
        metadata: sellerEventMetadata(metadata),
      };
    })
    .sort((left, right) => {
      const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
      return byTime || left.id.localeCompare(right.id);
    });
}

function sellerEventMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => SELLER_EVENT_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, toJsonSafe(value)]),
  );
}

function money(value, field) {
  return requiredSafeInteger(value, field, { min: 0 });
}

function optionalMoney(value, field) {
  return value === null || value === undefined ? null : money(value, field);
}

function invalid(message, field) {
  throw new CrmContractError("CRM_INVALID_SNAPSHOT", message, field);
}
