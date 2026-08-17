export const CRM_SCHEMA_VERSION = "jda-crm.v1";

export class CrmContractError extends Error {
  constructor(code, message, field = null, details = null) {
    super(message);
    this.name = "CrmContractError";
    this.code = code;
    this.field = field;
    this.details = details === null ? null : immutableJson(details);
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

export function immutableJson(value) {
  return deepFreeze(toJsonSafe(value));
}

export function toJsonSafe(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidSnapshot("El snapshot contiene un número no válido.");
    return value;
  }
  if (typeof value === "bigint") {
    const safe = Number(value);
    return Number.isSafeInteger(safe) ? safe : value.toString();
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) invalidSnapshot("El snapshot contiene una fecha no válida.");
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    assertNotCircular(value, seen);
    const result = value.map((item) => toJsonSafe(item, seen));
    seen.delete(value);
    return result;
  }
  if (value && typeof value === "object") {
    assertNotCircular(value, seen);
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) result[key] = toJsonSafe(nested, seen);
    }
    seen.delete(value);
    return result;
  }
  invalidSnapshot("El snapshot contiene datos no serializables.");
}

export function canonicalJson(value) {
  const json = toJsonSafe(value);
  return canonicalJsonValue(json);
}

export async function sha256Canonical(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CrmContractError(
      "CRM_HASH_UNAVAILABLE",
      "No se pudo verificar la identidad del comando.",
    );
  }
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function requiredText(value, field, { min = 1, max = 200 } = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < min || normalized.length > max) {
    throw new CrmContractError(
      "CRM_INVALID_CONTEXT",
      "El contexto comercial contiene datos inválidos.",
      field,
    );
  }
  return normalized;
}

export function requiredSafeInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  let normalized = value;
  if (typeof value === "bigint") {
    normalized = Number(value);
  }
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < min ||
    normalized > max
  ) {
    throw new CrmContractError(
      "CRM_INVALID_SNAPSHOT",
      "El snapshot comercial contiene un importe o entero inválido.",
      field,
    );
  }
  return normalized;
}

export function optionalSafeInteger(value, field, options) {
  return value === null || value === undefined
    ? null
    : requiredSafeInteger(value, field, options);
}

export function isoInstant(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new CrmContractError(
      "CRM_INVALID_SNAPSHOT",
      "El snapshot comercial contiene una fecha inválida.",
      field,
    );
  }
  return date.toISOString();
}

function canonicalJsonValue(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonValue).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJsonValue(nested)}`)
    .join(",")}}`;
}

function assertNotCircular(value, seen) {
  if (seen.has(value)) invalidSnapshot("El snapshot contiene referencias circulares.");
  seen.add(value);
}

function invalidSnapshot(message) {
  throw new CrmContractError("CRM_INVALID_SNAPSHOT", message);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
