import type { MutationResult } from "@/lib/data/admin-repositories";
import { AdminError } from "@/lib/admin";
import { ApiError, apiRoute, json, requiredInteger, requiredString } from "./api";
import {
  authenticateAdminRequest,
  type AdminApiActor,
  type AdminAuthOptions,
} from "./admin-auth";

export async function adminApiRoute(
  request: Request,
  run: (actor: AdminApiActor) => Promise<Response>,
  authOptions?: AdminAuthOptions,
): Promise<Response> {
  return apiRoute(async () => {
    try {
      return await run(await authenticateAdminRequest(request, authOptions));
    } catch (error) {
      if (error instanceof AdminError) {
        throw new ApiError(error.status, error.code, error.message);
      }
      throw error;
    }
  });
}

export function adminData(data: unknown, init: ResponseInit = {}): Response {
  return json({ data, meta: { serverNow: new Date().toISOString() } }, init);
}

export function expectedVersion(payload: Record<string, unknown>): number {
  return requiredInteger(payload, "expectedVersion", { min: 1, max: 2_147_483_647 });
}

export function requiredEnum<const T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = requiredString(payload, key, { max: 80 }) as T;
  if (!values.includes(value)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: `Debe ser uno de: ${values.join(", ")}.`,
    });
  }
  return value;
}

export function optionalEnum<const T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  if (payload[key] === undefined || payload[key] === null) return undefined;
  return requiredEnum(payload, key, values);
}

export function requiredIsoDate(payload: Record<string, unknown>, key: string): string {
  const value = requiredString(payload, key, { max: 40 });
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: "Debe ser una fecha ISO válida.",
    });
  }
  return date.toISOString();
}

export function optionalIsoDate(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  if (payload[key] === undefined || payload[key] === null) return undefined;
  return requiredIsoDate(payload, key);
}

export function requiredStringArray(
  payload: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): string[] {
  const value = payload[key];
  const min = options.min ?? 1;
  const max = options.max ?? 50;
  if (
    !Array.isArray(value) || value.length < min || value.length > max ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.length > 120)
  ) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: `Debe contener entre ${min} y ${max} textos válidos.`,
    });
  }
  return [...new Set(value.map((item) => String(item).trim()))];
}

export async function hashAdminPayload(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(sortJson(payload));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

export function mutationResponse<T>(result: MutationResult<T>): Response {
  if (result.ok) return adminData(result.record);
  if (result.reason === "not_found") {
    throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "El registro solicitado no existe.");
  }
  throw new ApiError(
    409,
    "ADMIN_VERSION_CONFLICT",
    "El registro cambió desde la última lectura. Recargalo antes de continuar.",
    result.currentVersion ? { currentVersion: String(result.currentVersion) } : undefined,
  );
}

export function idempotencyConflict(): never {
  throw new ApiError(
    409,
    "IDEMPOTENCY_CONFLICT",
    "La clave de idempotencia ya fue usada con otros datos.",
  );
}

export function ensureTransition(
  current: string,
  next: string,
  transitions: Readonly<Record<string, readonly string[]>>,
): void {
  if (!transitions[current]?.includes(next)) {
    throw new ApiError(422, "INVALID_STATE_TRANSITION", "El cambio de estado no está permitido.", {
      status: `${current} → ${next}`,
    });
  }
}

export const VEHICLE_TRANSITIONS = Object.freeze({
  DRAFT: ["AVAILABLE", "ARCHIVED"],
  AVAILABLE: ["RESERVED", "SOLD", "PAUSED", "ARCHIVED"],
  RESERVED: ["SOLD", "ARCHIVED"],
  SOLD: ["ARCHIVED"],
  PAUSED: ["ARCHIVED"],
  ARCHIVED: [],
});

export const LEAD_TRANSITIONS = Object.freeze({
  NEW: ["CONTACTED"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["WON", "LOST"],
  WON: [],
  LOST: [],
});

export const APPRAISAL_TRANSITIONS = Object.freeze({
  SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: ["ESTIMATED", "REJECTED"],
  ESTIMATED: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXPIRED"],
  REJECTED: [],
  EXPIRED: [],
});

export const FINANCE_TRANSITIONS = Object.freeze({
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["RETIRED"],
  RETIRED: [],
});

export const PROMOTION_TRANSITIONS = Object.freeze({
  DRAFT: ["SCHEDULED"],
  SCHEDULED: ["ACTIVE", "PAUSED", "ARCHIVED"],
  ACTIVE: ["PAUSED", "EXPIRED", "ARCHIVED"],
  PAUSED: ["SCHEDULED", "ARCHIVED"],
  EXPIRED: ["ARCHIVED"],
  ARCHIVED: [],
});
