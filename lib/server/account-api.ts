import {
  AuthError,
  clearedSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isAccountLocked,
  nextFailureState,
  normalizeEmail,
  readSessionCookie,
  requestIsSecure,
  sessionCookie,
  verifyPassword,
} from "../auth/index.mjs";
import type {
  CustomerAccountRecord,
  CustomerAccountRepositoryLike,
} from "@/lib/data/customer-account-repository";
import {
  ApiError,
  apiRoute,
  json,
  normalizePhone,
  optionalInteger,
  optionalString,
  readJsonObject,
  requiredString,
} from "./api.ts";

export type AccountRuntime = Readonly<{
  repository?: CustomerAccountRepositoryLike;
  now?: Date;
  idGenerator?: () => string;
}>;

type Session = Readonly<{
  sessionId: string;
  token: string;
  account: CustomerAccountRecord;
}>;

/**
 * El repositorio de D1 se carga recién cuando nadie inyectó uno. Así la capa se
 * puede probar sin binding de base y sin arrastrar el runtime del Worker.
 */
async function repositoryOf(runtime: AccountRuntime): Promise<CustomerAccountRepositoryLike> {
  if (runtime.repository) return runtime.repository;
  const { D1CustomerAccountRepository } = await import("@/lib/data/customer-account-repository");
  return new D1CustomerAccountRepository();
}

function instant(runtime: AccountRuntime): Date {
  return runtime.now ?? new Date();
}

function newId(runtime: AccountRuntime): string {
  return runtime.idGenerator?.() ?? crypto.randomUUID();
}

function authApiError(error: unknown): never {
  if (error instanceof AuthError) {
    throw new ApiError(422, error.code, error.message, error.fields ?? undefined);
  }
  throw error;
}

/**
 * Un único mensaje para credenciales incorrectas, cuenta inexistente y cuenta
 * dada de baja: la respuesta no dice si el correo está registrado.
 */
function invalidCredentials(): ApiError {
  return new ApiError(
    401,
    "INVALID_CREDENTIALS",
    "El correo o la contraseña no coinciden.",
  );
}

function accountDto(account: CustomerAccountRecord) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phoneNormalized,
    linkedToCrm: account.leadId !== null,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  };
}

// ── Sesión ─────────────────────────────────────────────────────────────────

async function resolveSession(
  request: Request,
  runtime: AccountRuntime,
): Promise<Session | null> {
  const token = readSessionCookie(request.headers.get("cookie"));
  if (!token) return null;
  let tokenHash: string;
  try {
    tokenHash = await hashSessionToken(token);
  } catch {
    return null;
  }
  const found = await (await repositoryOf(runtime)).findSessionAccount(
    tokenHash,
    instant(runtime).toISOString(),
  );
  if (!found) return null;
  return { sessionId: found.sessionId, token, account: found.account };
}

/**
 * Guard de las rutas privadas de la cuenta. Falla cerrado: sin cookie válida,
 * con sesión vencida o revocada, o con la cuenta dada de baja, responde 401 sin
 * distinguir cuál de los casos ocurrió.
 */
async function requireSession(
  request: Request,
  runtime: AccountRuntime,
): Promise<Session> {
  const session = await resolveSession(request, runtime);
  if (!session) {
    throw new ApiError(401, "ACCOUNT_SESSION_REQUIRED", "Iniciá sesión para continuar.");
  }
  return session;
}

/** Lectura sin excepción, para que las páginas públicas se adapten. */
export async function readAccountSession(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<CustomerAccountRecord | null> {
  const session = await resolveSession(request, runtime);
  return session?.account ?? null;
}

/**
 * Misma resolución que el guard, para componentes de servidor que sólo tienen
 * el encabezado de cookies. Devuelve null en vez de fallar: una página pública
 * se renderiza igual sin sesión.
 */
export async function readAccountSessionFromCookie(
  cookieHeader: string | null,
  runtime: AccountRuntime = {},
): Promise<CustomerAccountRecord | null> {
  const token = readSessionCookie(cookieHeader);
  if (!token) return null;
  try {
    const found = await (await repositoryOf(runtime)).findSessionAccount(
      await hashSessionToken(token),
      instant(runtime).toISOString(),
    );
    return found?.account ?? null;
  } catch {
    return null;
  }
}

/** Contexto mínimo para que una ficha sepa si ofrecer guardar o ingresar. */
export async function readFavoriteContext(
  cookieHeader: string | null,
  vehicleId: string,
  runtime: AccountRuntime = {},
): Promise<{ signedIn: boolean; saved: boolean }> {
  const account = await readAccountSessionFromCookie(cookieHeader, runtime);
  if (!account) return { signedIn: false, saved: false };
  const favorites = await (await repositoryOf(runtime)).listFavorites(account.id);
  return {
    signedIn: true,
    saved: favorites.some((favorite) => favorite.vehicleId === vehicleId),
  };
}

/** Datos completos de la cuenta para la pantalla privada. */
export async function readAccountDashboard(
  cookieHeader: string | null,
  runtime: AccountRuntime = {},
) {
  const account = await readAccountSessionFromCookie(cookieHeader, runtime);
  if (!account) return null;
  const repository = await repositoryOf(runtime);
  const [preferences, favorites, searches, activity] = await Promise.all([
    repository.readPreferences(account.id),
    repository.listFavorites(account.id),
    repository.listSavedSearches(account.id),
    repository.readActivity(account.leadId),
  ]);
  return { account, preferences, favorites, searches, activity };
}

async function openSessionResponse(
  request: Request,
  runtime: AccountRuntime,
  account: CustomerAccountRecord,
  body: Record<string, unknown>,
  status: number,
): Promise<Response> {
  const now = instant(runtime);
  const session = await createSessionToken(now);
  await (await repositoryOf(runtime)).openSession({
    sessionId: newId(runtime),
    accountId: account.id,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    occurredAt: now.toISOString(),
  });
  return json(body, {
    status,
    headers: {
      "Set-Cookie": sessionCookie({
        token: session.token,
        expiresAt: session.expiresAt,
        secure: requestIsSecure(request),
      }),
    },
  });
}

// ── Registro e ingreso ─────────────────────────────────────────────────────

export function registerAccountResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const payload = await readJsonObject(request);
    const name = requiredString(payload, "name", { min: 2, max: 120 });
    const rawPhone = optionalString(payload, "phone", 40);
    const phoneNormalized = rawPhone ? normalizePhone(rawPhone) : null;
    if (payload.acceptedTerms !== true) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        acceptedTerms: "Tenés que aceptar los términos para crear la cuenta.",
      });
    }

    let email: string;
    let password: Awaited<ReturnType<typeof hashPassword>>;
    try {
      email = normalizeEmail(payload.email);
      password = await hashPassword(String(payload.password ?? ""));
    } catch (error) {
      authApiError(error);
    }

    const now = instant(runtime);
    const created = await (await repositoryOf(runtime)).create({
      accountId: newId(runtime),
      email,
      name,
      phoneNormalized,
      password,
      leadId: null,
      occurredAt: now.toISOString(),
    });
    if (!created.ok) {
      // El correo ya registrado sí se informa: la persona está frente al
      // formulario de alta y necesita saber que tiene que ingresar.
      throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ese correo ya tiene una cuenta.", {
        email: "Ya está registrado. Probá ingresar.",
      });
    }

    return openSessionResponse(
      request,
      runtime,
      created.record,
      { data: accountDto(created.record) },
      201,
    );
  });
}

export function loginResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const payload = await readJsonObject(request);
    const submitted = typeof payload.password === "string" ? payload.password : "";
    let email: string;
    try {
      email = normalizeEmail(payload.email);
    } catch {
      throw invalidCredentials();
    }

    const repository = await repositoryOf(runtime);
    const now = instant(runtime);
    const found = await repository.findByEmail(email);
    if (!found) {
      // Se deriva igual sobre una sal descartable para no acortar el tiempo de
      // respuesta cuando el correo no existe.
      await hashPassword(submitted.length >= 10 ? submitted : "placeholder-sin-cuenta", {
        iterations: 1_000,
      }).catch(() => undefined);
      throw invalidCredentials();
    }
    if (found.account.status !== "ACTIVE") throw invalidCredentials();
    if (isAccountLocked(found.account, now)) {
      throw new ApiError(
        429,
        "ACCOUNT_TEMPORARILY_LOCKED",
        "Demasiados intentos fallidos. Probá de nuevo en unos minutos.",
      );
    }

    const verification = await verifyPassword(submitted, found.password);
    if (!verification.ok) {
      const failure = nextFailureState(found.account, now);
      await repository.registerFailedAttempt({
        accountId: found.account.id,
        failedAttempts: failure.failedAttempts,
        lockedUntil: failure.lockedUntil,
        occurredAt: now.toISOString(),
      });
      throw invalidCredentials();
    }

    const rehashed = verification.needsRehash
      ? await hashPassword(submitted).catch(() => undefined)
      : undefined;
    await repository.registerSuccessfulLogin({
      accountId: found.account.id,
      occurredAt: now.toISOString(),
      password: rehashed,
    });

    return openSessionResponse(
      request,
      runtime,
      found.account,
      { data: accountDto(found.account) },
      200,
    );
  });
}

export function logoutResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const token = readSessionCookie(request.headers.get("cookie"));
    if (token) {
      try {
        await (await repositoryOf(runtime)).revokeSession(
          await hashSessionToken(token),
          instant(runtime).toISOString(),
        );
      } catch {
        // Cerrar sesión siempre limpia la cookie del navegador, aunque la
        // revocación no haya podido escribirse.
      }
    }
    return json(
      { data: { ok: true } },
      {
        headers: {
          "Set-Cookie": clearedSessionCookie({ secure: requestIsSecure(request) }),
        },
      },
    );
  });
}

// ── Perfil y contraseña ────────────────────────────────────────────────────

export function accountProfileResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const session = await requireSession(request, runtime);
    const repository = await repositoryOf(runtime);

    if (request.method === "GET") {
      const preferences = await repository.readPreferences(session.account.id);
      return json({ data: { account: accountDto(session.account), preferences } });
    }
    if (request.method !== "PATCH") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }

    const payload = await readJsonObject(request);
    const name = requiredString(payload, "name", { min: 2, max: 120 });
    const rawPhone = optionalString(payload, "phone", 40);
    const updated = await repository.updateProfile({
      accountId: session.account.id,
      name,
      phoneNormalized: rawPhone ? normalizePhone(rawPhone) : null,
      occurredAt: instant(runtime).toISOString(),
    });
    if (!updated) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "No encontramos la cuenta.");
    return json({ data: accountDto(updated) });
  });
}

export function accountPasswordResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "PUT") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const session = await requireSession(request, runtime);
    const payload = await readJsonObject(request);
    const repository = await repositoryOf(runtime);

    const found = await repository.findByEmail(session.account.email);
    if (!found) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "No encontramos la cuenta.");
    const current = await verifyPassword(String(payload.currentPassword ?? ""), found.password);
    if (!current.ok) {
      throw new ApiError(422, "INVALID_CREDENTIALS", "La contraseña actual no coincide.", {
        currentPassword: "No coincide.",
      });
    }

    let password: Awaited<ReturnType<typeof hashPassword>>;
    try {
      password = await hashPassword(String(payload.newPassword ?? ""));
    } catch (error) {
      authApiError(error);
    }

    await repository.updatePassword({
      accountId: session.account.id,
      password,
      keepSessionId: session.sessionId,
      occurredAt: instant(runtime).toISOString(),
    });
    return json({ data: { ok: true, otherSessionsRevoked: true } });
  });
}

// ── Preferencias ───────────────────────────────────────────────────────────

function stringList(payload: Record<string, unknown>, key: string, max: number): string[] {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      [key]: "Debe ser una lista.",
    });
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 60);
  return [...new Set(items)].slice(0, max);
}

export function accountPreferencesResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const session = await requireSession(request, runtime);
    const repository = await repositoryOf(runtime);

    if (request.method === "GET") {
      return json({ data: await repository.readPreferences(session.account.id) });
    }
    if (request.method !== "PUT") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }

    const payload = await readJsonObject(request);
    const budgetCents = optionalInteger(payload, "budgetCents", { min: 0, max: 100_000_000_00 });
    const maxMonthlyPaymentCents = optionalInteger(payload, "maxMonthlyPaymentCents", {
      min: 0,
      max: 100_000_000_00,
    });
    const currentVehicle =
      payload.currentVehicle && typeof payload.currentVehicle === "object" && !Array.isArray(payload.currentVehicle)
        ? normalizeCurrentVehicle(payload.currentVehicle as Record<string, unknown>)
        : null;

    const preferences = await repository.savePreferences({
      accountId: session.account.id,
      budgetCents: budgetCents ?? null,
      maxMonthlyPaymentCents: maxMonthlyPaymentCents ?? null,
      preferredMakes: stringList(payload, "preferredMakes", 12),
      preferredBodyTypes: stringList(payload, "preferredBodyTypes", 8),
      currentVehicle,
      occurredAt: instant(runtime).toISOString(),
    });
    return json({ data: preferences });
  });
}

/** El vehículo actual es declarativo: se guarda tal cual, sin tasarlo. */
function normalizeCurrentVehicle(value: Record<string, unknown>): Record<string, unknown> | null {
  const make = typeof value.make === "string" ? value.make.trim().slice(0, 80) : "";
  const model = typeof value.model === "string" ? value.model.trim().slice(0, 100) : "";
  if (!make && !model) return null;
  const year = Number(value.year);
  const mileageKm = Number(value.mileageKm);
  return {
    make,
    model,
    year: Number.isSafeInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    mileageKm:
      Number.isSafeInteger(mileageKm) && mileageKm >= 0 && mileageKm <= 5_000_000
        ? mileageKm
        : null,
  };
}

// ── Favoritos ──────────────────────────────────────────────────────────────

export function accountFavoritesResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const session = await requireSession(request, runtime);
    const repository = await repositoryOf(runtime);

    if (request.method === "GET") {
      return json({ data: await repository.listFavorites(session.account.id) });
    }
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }

    const payload = await readJsonObject(request);
    const vehicleId = requiredString(payload, "vehicleId", { min: 3, max: 80 });
    const added = await repository.addFavorite({
      favoriteId: newId(runtime),
      accountId: session.account.id,
      vehicleId,
      occurredAt: instant(runtime).toISOString(),
    });
    if (!added.ok) {
      throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    }
    return json({ data: { ok: true, vehicleId } }, { status: 201 });
  });
}

export function accountFavoriteItemResponse(
  request: Request,
  vehicleId: string,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "DELETE") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const session = await requireSession(request, runtime);
    if (!/^[A-Za-z0-9._:-]{3,80}$/.test(vehicleId)) {
      throw new ApiError(400, "INVALID_VEHICLE_ID", "El identificador no es válido.");
    }
    await (await repositoryOf(runtime)).removeFavorite(session.account.id, vehicleId);
    return json({ data: { ok: true } });
  });
}

// ── Búsquedas guardadas ────────────────────────────────────────────────────

export function accountSearchesResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const session = await requireSession(request, runtime);
    const repository = await repositoryOf(runtime);

    if (request.method === "GET") {
      return json({ data: await repository.listSavedSearches(session.account.id) });
    }
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }

    const payload = await readJsonObject(request);
    const name = requiredString(payload, "name", { min: 2, max: 60 });
    const rawQuery = payload.query;
    if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        query: "Debe ser un objeto de filtros.",
      });
    }
    const query = normalizeSearchQuery(rawQuery as Record<string, unknown>);
    await repository.saveSearch({
      searchId: newId(runtime),
      accountId: session.account.id,
      name,
      query,
      occurredAt: instant(runtime).toISOString(),
    });
    return json({ data: { ok: true, name, query } }, { status: 201 });
  });
}

/** Se guarda sólo el subconjunto de filtros que la web sabe volver a aplicar. */
function normalizeSearchQuery(value: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const key of ["make", "bodyType", "fuelType", "transmission"] as const) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) query[key] = item.trim().slice(0, 60);
  }
  for (const key of ["minPriceCents", "maxPriceCents", "minYear", "maxYear", "maxMileageKm"] as const) {
    const item = Number(value[key]);
    if (Number.isSafeInteger(item) && item >= 0) query[key] = item;
  }
  return query;
}

export function accountSearchItemResponse(
  request: Request,
  searchId: string,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "DELETE") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const session = await requireSession(request, runtime);
    if (!/^[A-Za-z0-9._:-]{3,80}$/.test(searchId)) {
      throw new ApiError(400, "INVALID_SEARCH_ID", "El identificador no es válido.");
    }
    await (await repositoryOf(runtime)).removeSavedSearch(session.account.id, searchId);
    return json({ data: { ok: true } });
  });
}

// ── Actividad ──────────────────────────────────────────────────────────────

export function accountActivityResponse(
  request: Request,
  runtime: AccountRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    if (request.method !== "GET") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const session = await requireSession(request, runtime);
    const activity = await (await repositoryOf(runtime)).readActivity(session.account.leadId);
    return json({ data: { ...activity, linkedToCrm: session.account.leadId !== null } });
  });
}
