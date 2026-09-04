import { hashSessionToken } from "@/lib/auth/index.mjs";
import { D1DemandRepository, type DemandRepositoryLike, type PassportReviewRecord } from "@/lib/data/demand-repository";
import { normalizeDemandCriteria } from "@/lib/domain/demand-matching.mjs";
import { ApiError, publicCode, requiredInteger } from "./api";

const REVIEW_TOKEN = /^[A-Za-z0-9_-]{32,80}$/;
const DEFAULT_DEMAND_DAYS = 30;
const MIN_DEMAND_DAYS = 7;

export type PublicPassportReview = Readonly<PassportReviewRecord>;

export async function findPublicPassportReview(
  token: string,
  repository: DemandRepositoryLike = new D1DemandRepository(),
): Promise<PublicPassportReview | null> {
  if (!REVIEW_TOKEN.test(token)) return null;
  return repository.findPassportByReviewTokenHash(await hashSessionToken(token));
}

function stringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10 || value.some((item) => typeof item !== "string")) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", { [key]: "Debe ser una lista de hasta 10 textos." });
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function nullableInteger(
  payload: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  if (payload[key] === null || payload[key] === undefined || payload[key] === "") return null;
  return requiredInteger(payload, key, { min, max });
}

function nullableText(payload: Record<string, unknown>, key: string, max: number): string | null {
  const value = payload[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", { [key]: `Debe tener hasta ${max} caracteres.` });
  }
  return value.trim() || null;
}

export async function confirmPublicPassportReview(
  token: string,
  payload: Record<string, unknown>,
  runtime: { repository?: DemandRepositoryLike; now?: Date } = {},
): Promise<"confirmed" | "not_found" | "conflict" | "already_confirmed"> {
  if (!REVIEW_TOKEN.test(token)) return "not_found";
  const expectedVersion = requiredInteger(payload, "expectedVersion", { min: 1, max: 1_000_000 });
  const budgetCents = requiredInteger(payload, "budgetCents", { min: 1, max: Number.MAX_SAFE_INTEGER });
  const currency = String(payload.currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", { currency: "Indicá una moneda válida." });
  }
  const criteria = normalizeDemandCriteria({
    makes: stringList(payload, "desiredMakes"),
    models: stringList(payload, "desiredModels"),
    types: stringList(payload, "acceptedTypes"),
    minYear: nullableInteger(payload, "minYear", 1950, 2100),
    maxPriceCents: budgetCents,
    maxMileageKm: nullableInteger(payload, "maxMileageKm", 0, 3_000_000),
    currency,
    tradeIn: nullableText(payload, "tradeInDescription", 200) !== null,
    urgencyDays: nullableInteger(payload, "urgencyDays", 0, 3650),
  });
  const now = runtime.now ?? new Date();
  const urgencyDays = criteria.urgencyDays ?? DEFAULT_DEMAND_DAYS;
  const repository = runtime.repository ?? new D1DemandRepository();
  const demandId = crypto.randomUUID();
  return repository.confirmPassportReview({
    tokenHash: await hashSessionToken(token),
    expectedVersion,
    budgetCents,
    currency,
    desiredMakes: criteria.makes,
    desiredModels: criteria.models,
    acceptedTypes: criteria.types,
    minYear: criteria.minYear,
    maxMileageKm: criteria.maxMileageKm,
    tradeInDescription: nullableText(payload, "tradeInDescription", 200),
    urgencyDays: criteria.urgencyDays,
    locality: nullableText(payload, "locality", 80),
    demandId,
    demandPublicCode: publicCode("DEM"),
    criteria,
    validUntil: new Date(now.getTime() + Math.max(urgencyDays, MIN_DEMAND_DAYS) * 86_400_000).toISOString(),
    eventId: crypto.randomUUID(),
    confirmedAt: now.toISOString(),
  });
}
