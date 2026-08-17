import {
  CRM_SCHEMA_VERSION,
  CrmContractError,
  immutableJson,
  requiredText,
  sha256Canonical,
} from "./contracts.mjs";

const PUBLIC_CODE = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE = /^[A-Za-z0-9_-]+$/;
const PHONE = /^\+?\d{8,15}$/;

/**
 * Normalizes only non-PII operation selectors. Both fields are optional as a
 * pair so the existing general-contact lead contract remains valid.
 */
export function normalizeContextualLeadContext(input = {}) {
  const hasCode = input.simulationCode !== undefined && input.simulationCode !== null && input.simulationCode !== "";
  const hasSlug = input.vehicleSlug !== undefined && input.vehicleSlug !== null && input.vehicleSlug !== "";
  if (!hasCode && !hasSlug) return null;
  if (!hasCode || !hasSlug) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "La simulación y la unidad deben informarse juntas.",
      hasCode ? "vehicleSlug" : "simulationCode",
    );
  }
  const simulationCode = requiredText(input.simulationCode, "simulationCode", { min: 4, max: 40 }).toUpperCase();
  const vehicleSlug = requiredText(input.vehicleSlug, "vehicleSlug", { min: 3, max: 120 }).toLowerCase();
  if (!PUBLIC_CODE.test(simulationCode)) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El código de simulación no es válido.",
      "simulationCode",
    );
  }
  if (!PUBLIC_SLUG.test(vehicleSlug)) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El identificador de la unidad no es válido.",
      "vehicleSlug",
    );
  }
  return immutableJson({ simulationCode, vehicleSlug });
}

/**
 * Checks authoritative rows against the requested selectors. It does not
 * mutate or calculate any commercial condition.
 */
export function validateContextualConversion({
  leadId,
  simulationCode,
  vehicleSlug,
  simulation,
  vehicle,
}) {
  const context = normalizeContextualLeadContext({ simulationCode, vehicleSlug });
  if (!context) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "La conversión contextual requiere una simulación y una unidad.",
    );
  }
  const safeLeadId = requiredText(leadId, "leadId", { max: 80 });
  if (!simulation || typeof simulation !== "object") {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "No encontramos la simulación asociada.",
      "simulationCode",
    );
  }
  if (!vehicle || typeof vehicle !== "object") {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "No encontramos la unidad asociada.",
      "vehicleSlug",
    );
  }

  const authoritativeCode = requiredText(simulation.publicCode, "simulation.publicCode", { min: 4, max: 40 }).toUpperCase();
  if (authoritativeCode !== context.simulationCode) {
    mismatch(
      "CRM_SIMULATION_CODE_MISMATCH",
      "La simulación solicitada no coincide con el snapshot almacenado.",
      "simulationCode",
    );
  }
  const authoritativeSlug = requiredText(vehicle.slug, "vehicle.slug", { min: 3, max: 120 }).toLowerCase();
  if (authoritativeSlug !== context.vehicleSlug) {
    mismatch(
      "CRM_VEHICLE_SLUG_MISMATCH",
      "La unidad solicitada no coincide con el stock almacenado.",
      "vehicleSlug",
    );
  }
  const simulationVehicleId = requiredText(simulation.vehicleId, "simulation.vehicleId", { max: 80 });
  const vehicleId = requiredText(vehicle.id, "vehicle.id", { max: 80 });
  if (simulationVehicleId !== vehicleId) {
    mismatch(
      "CRM_SIMULATION_VEHICLE_MISMATCH",
      "La simulación pertenece a otra unidad.",
      "vehicleSlug",
    );
  }
  if (simulation.leadId !== null && simulation.leadId !== undefined && simulation.leadId !== safeLeadId) {
    throw new CrmContractError(
      "CRM_SIMULATION_ALREADY_LINKED",
      "La simulación ya está vinculada a otro contacto.",
      "simulationCode",
    );
  }

  return immutableJson({
    schemaVersion: CRM_SCHEMA_VERSION,
    leadId: safeLeadId,
    simulationId: requiredText(simulation.id, "simulation.id", { max: 80 }),
    simulationCode: authoritativeCode,
    vehicleId,
    vehicleSlug: authoritativeSlug,
    promotionId:
      simulation.promotionId === null || simulation.promotionId === undefined
        ? null
        : requiredText(simulation.promotionId, "simulation.promotionId", { max: 80 }),
  });
}

/**
 * Returns opaque hashes only. `contextHash` never includes PII. Identity PII is
 * hashed separately and is folded into `commandHash`; callers must not log the
 * source `identity` object.
 */
export async function fingerprintContextualLeadCommand({ identity, command }) {
  if (!identity || typeof identity !== "object" || !command || typeof command !== "object") {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El comando contextual está incompleto.",
    );
  }
  const context = normalizeContextualLeadContext(command);
  if (!context) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El comando contextual requiere una simulación y una unidad.",
    );
  }
  const name = requiredText(identity.name, "name", { min: 2, max: 120 });
  const phoneNormalized = requiredText(identity.phoneNormalized, "phoneNormalized", { min: 8, max: 16 });
  if (!PHONE.test(phoneNormalized)) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El teléfono normalizado no es válido.",
      "phoneNormalized",
    );
  }
  if (command.contactConsent !== true) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "Se requiere consentimiento de contacto.",
      "contactConsent",
    );
  }
  const source = requiredText(command.source, "source", { max: 64 });
  if (!SOURCE.test(source)) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El origen del contacto no es válido.",
      "source",
    );
  }

  const commercialCommand = {
    schemaVersion: `${CRM_SCHEMA_VERSION}.lead-command.v1`,
    contactConsent: true,
    source,
    context,
  };
  const identityHash = await sha256Canonical({
    schemaVersion: `${CRM_SCHEMA_VERSION}.identity.v1`,
    name,
    phoneNormalized,
  });
  const contextHash = await sha256Canonical(commercialCommand);
  const commandHash = await sha256Canonical({
    schemaVersion: `${CRM_SCHEMA_VERSION}.lead-command-fingerprint.v1`,
    contextHash,
    identityHash,
  });
  return immutableJson({
    schemaVersion: `${CRM_SCHEMA_VERSION}.lead-command-fingerprint.v1`,
    commandHash,
    contextHash,
  });
}

function mismatch(code, message, field) {
  throw new CrmContractError(code, message, field);
}
