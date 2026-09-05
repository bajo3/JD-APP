import {
  D1RateLimitRepository,
  type RateLimitRepositoryLike,
} from "@/lib/data/rate-limit-repository";
import { isIP } from "node:net";
import { ApiError, apiErrorResponse } from "./api";

export const RATE_LIMIT_RESOURCES = [
  "public.search",
  "public.simulation",
  "public.lead",
  "public.handoff",
  "public.appraisal",
  "public.appraisal-photo",
  "public.consignment",
  "public.consignment-photo",
  "public.account-register",
  "public.account-login",
  "public.passport-review",
] as const;

export type RateLimitResource = (typeof RATE_LIMIT_RESOURCES)[number];

type ResourceLimit = Readonly<{
  limit: number;
  windowMinutes: number;
  env: string;
}>;

// Límites por recurso e IP sobre ventana fija. Cada uno se puede sobreescribir
// por entorno con `N` (sólo tope) o `N/MINUTOS` (tope y ventana).
const DEFAULT_LIMITS: Readonly<Record<RateLimitResource, ResourceLimit>> = {
  "public.search": { limit: 30, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_SEARCH" },
  "public.simulation": { limit: 30, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_SIMULATION" },
  "public.lead": { limit: 10, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_LEAD" },
  "public.handoff": { limit: 10, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_HANDOFF" },
  "public.appraisal": { limit: 10, windowMinutes: 30, env: "RATE_LIMIT_PUBLIC_APPRAISAL" },
  "public.appraisal-photo": { limit: 30, windowMinutes: 30, env: "RATE_LIMIT_PUBLIC_APPRAISAL_PHOTO" },
  "public.consignment": { limit: 6, windowMinutes: 60, env: "RATE_LIMIT_PUBLIC_CONSIGNMENT" },
  "public.consignment-photo": { limit: 30, windowMinutes: 60, env: "RATE_LIMIT_PUBLIC_CONSIGNMENT_PHOTO" },
  // El ingreso es el objetivo natural de un ataque de fuerza bruta: el tope por
  // IP frena el barrido sobre muchas cuentas y el bloqueo por cuenta frena la
  // insistencia sobre una sola.
  "public.account-register": { limit: 5, windowMinutes: 60, env: "RATE_LIMIT_PUBLIC_ACCOUNT_REGISTER" },
  "public.account-login": { limit: 12, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_ACCOUNT_LOGIN" },
  "public.passport-review": { limit: 20, windowMinutes: 10, env: "RATE_LIMIT_PUBLIC_PASSPORT_REVIEW" },
};

export type RateLimitRuntime = Readonly<{
  repository?: RateLimitRepositoryLike;
  now?: Date;
}>;

function configuredLimit(resource: RateLimitResource): ResourceLimit {
  const fallback = DEFAULT_LIMITS[resource];
  const raw = process.env[fallback.env]?.trim();
  if (!raw) return fallback;
  const match = /^(\d{1,6})(?:\/(\d{1,4}))?$/.exec(raw);
  if (!match) return fallback;
  const limit = Number(match[1]);
  const windowMinutes = match[2] ? Number(match[2]) : fallback.windowMinutes;
  if (limit < 1 || windowMinutes < 1) return fallback;
  return { ...fallback, limit, windowMinutes };
}

function identity(request: Request): string {
  const headerName = process.env.VERCEL === "1"
    ? "x-vercel-forwarded-for"
    : "CF-Connecting-IP";
  const raw = request.headers.get(headerName)?.trim() ?? "";
  if (process.env.VERCEL !== "1") {
    return isIP(raw) > 0 ? normalizeIp(raw) : "unknown";
  }
  // Vercel provides one trusted client address. A list, a forwarded chain or
  // any malformed value must fail before touching the D1 counter.
  if (!raw || /[\s,]/.test(raw) || isIP(raw) === 0) {
    throw new ApiError(
      503,
      "RATE_LIMIT_IDENTITY_UNAVAILABLE",
      "No pudimos verificar el origen de la solicitud.",
    );
  }
  return normalizeIp(raw);
}

function normalizeIp(ip: string): string {
  if (isIP(ip) === 4) {
    return ip.split(".").map((part) => String(Number(part))).join(".");
  }
  return normalizeIpv6(ip);
}

function normalizeIpv6(ip: string): string {
  if (ip.includes("%")) return ip.toLowerCase();
  try {
    // WHATWG URL performs canonical compression and also normalizes
    // IPv4-mapped addresses (for example ::ffff:192.0.2.1).
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return ip.toLowerCase();
  }
}

export async function enforceRateLimit(
  request: Request,
  resource: RateLimitResource,
  runtime: RateLimitRuntime = {},
): Promise<void> {
  const config = configuredLimit(resource);
  const now = runtime.now ?? new Date();
  const windowMs = config.windowMinutes * 60_000;
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const key = `${resource}:${identity(request)}:${new Date(windowStartMs).toISOString()}`;

  const repository = runtime.repository ?? new D1RateLimitRepository();
  const { hits } = await repository.hit({
    key,
    resource,
    expiresAt: new Date(windowStartMs + windowMs).toISOString(),
  });
  // Depuración amortizada de ventanas vencidas; una falla acá no debe
  // tumbar el request que ya está autorizado por el contador vigente.
  if (Math.random() < 0.02) {
    try {
      await repository.removeExpired(now.toISOString());
    } catch {
      // La ventana sigue siendo funcional aunque la limpieza no corra.
    }
  }
  if (hits > config.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartMs + windowMs - now.getTime()) / 1000),
    );
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Demasiadas solicitudes. Esperá un momento e intentá de nuevo.",
      undefined,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
}

/**
 * Envuelve una ruta pública: cuenta el intento en D1 antes de ejecutar el
 * handler y responde 429 estable con Retry-After cuando la ventana se agota.
 * Los handlers siguen probándose sin pasar por la ruta, así que la suite
 * existente no depende del limitador.
 */
export function withRateLimit<Args extends unknown[]>(
  resource: RateLimitResource,
  handler: (request: Request, ...args: Args) => Promise<Response>,
  runtime?: RateLimitRuntime,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      await enforceRateLimit(request, resource, runtime);
      return await handler(request, ...args);
    } catch (error) {
      return apiErrorResponse(error);
    }
  };
}
