import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_FAILED_ATTEMPTS,
  clearedSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isAccountLocked,
  isSessionUsable,
  nextFailureState,
  normalizeEmail,
  readSessionCookie,
  sessionCookie,
  timingSafeEqual,
  verifyPassword,
} from "../lib/auth/index.mjs";
import {
  accountFavoritesResponse,
  accountPreferencesResponse,
  loginResponse,
  logoutResponse,
  registerAccountResponse,
} from "../lib/server/account-api.ts";
import { PanelAccessError, requirePanelUser } from "../lib/server/panel-auth.ts";

const root = new URL("../", import.meta.url);
const NOW = new Date("2026-08-26T12:00:00.000Z");
const PASSWORD = "una-clave-larga-2026";

function jsonRequest(url, method, body, cookie) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Repositorio en memoria con la misma superficie que usa la capa de servidor. */
function repository(seed = {}) {
  const state = {
    accounts: new Map(),
    passwords: new Map(),
    sessions: new Map(),
    favorites: new Map(),
    preferences: new Map(),
    searches: new Map(),
    ...seed,
  };
  return {
    state,
    async create(input) {
      if ([...state.accounts.values()].some((account) => account.email === input.email)) {
        return { ok: false, reason: "email_taken" };
      }
      const record = Object.freeze({
        id: input.accountId,
        email: input.email,
        name: input.name,
        phoneNormalized: input.phoneNormalized,
        leadId: input.leadId,
        status: "ACTIVE",
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        version: 1,
        createdAt: input.occurredAt,
      });
      state.accounts.set(record.id, record);
      state.passwords.set(record.id, input.password);
      return { ok: true, record };
    },
    async findByEmail(email) {
      const account = [...state.accounts.values()].find((item) => item.email === email);
      if (!account) return null;
      return { account, password: state.passwords.get(account.id) };
    },
    async findById(accountId) {
      return state.accounts.get(accountId) ?? null;
    },
    async findSessionAccount(tokenHash, now) {
      const session = state.sessions.get(tokenHash);
      if (!session || session.revokedAt) return null;
      if (Date.parse(session.expiresAt) <= Date.parse(now)) return null;
      const account = state.accounts.get(session.accountId);
      if (!account || account.status !== "ACTIVE") return null;
      return { sessionId: session.sessionId, account };
    },
    async openSession(input) {
      state.sessions.set(input.tokenHash, { ...input, revokedAt: null });
    },
    async revokeSession(tokenHash, occurredAt) {
      const session = state.sessions.get(tokenHash);
      if (session) session.revokedAt = occurredAt;
    },
    async registerFailedAttempt(input) {
      const account = state.accounts.get(input.accountId);
      state.accounts.set(input.accountId, {
        ...account,
        failedAttempts: input.failedAttempts,
        lockedUntil: input.lockedUntil,
      });
    },
    async registerSuccessfulLogin(input) {
      const account = state.accounts.get(input.accountId);
      state.accounts.set(input.accountId, {
        ...account,
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: input.occurredAt,
      });
      if (input.password) state.passwords.set(input.accountId, input.password);
    },
    async updateProfile(input) {
      const account = state.accounts.get(input.accountId);
      const updated = { ...account, name: input.name, phoneNormalized: input.phoneNormalized };
      state.accounts.set(input.accountId, updated);
      return updated;
    },
    async updatePassword(input) {
      state.passwords.set(input.accountId, input.password);
      for (const [hash, session] of state.sessions) {
        if (session.accountId === input.accountId && session.sessionId !== input.keepSessionId) {
          state.sessions.get(hash).revokedAt = input.occurredAt;
        }
      }
    },
    async readPreferences(accountId) {
      return (
        state.preferences.get(accountId) ?? {
          budgetCents: null,
          maxMonthlyPaymentCents: null,
          currency: "ARS",
          preferredMakes: [],
          preferredBodyTypes: [],
          currentVehicle: null,
          version: 1,
          updatedAt: null,
        }
      );
    },
    async savePreferences(input) {
      const saved = {
        budgetCents: input.budgetCents,
        maxMonthlyPaymentCents: input.maxMonthlyPaymentCents,
        currency: "ARS",
        preferredMakes: input.preferredMakes,
        preferredBodyTypes: input.preferredBodyTypes,
        currentVehicle: input.currentVehicle,
        version: 1,
        updatedAt: input.occurredAt,
      };
      state.preferences.set(input.accountId, saved);
      return saved;
    },
    async listFavorites(accountId) {
      return state.favorites.get(accountId) ?? [];
    },
    async addFavorite(input) {
      if (input.vehicleId === "vehicle-inexistente") {
        return { ok: false, reason: "vehicle_not_found" };
      }
      const current = state.favorites.get(input.accountId) ?? [];
      if (!current.some((item) => item.vehicleId === input.vehicleId)) {
        current.push({ id: input.favoriteId, vehicleId: input.vehicleId });
      }
      state.favorites.set(input.accountId, current);
      return { ok: true };
    },
    async removeFavorite(accountId, vehicleId) {
      state.favorites.set(
        accountId,
        (state.favorites.get(accountId) ?? []).filter((item) => item.vehicleId !== vehicleId),
      );
    },
    async listSavedSearches(accountId) {
      return state.searches.get(accountId) ?? [];
    },
    async saveSearch(input) {
      const current = state.searches.get(input.accountId) ?? [];
      current.push({ id: input.searchId, name: input.name, query: input.query });
      state.searches.set(input.accountId, current);
    },
    async removeSavedSearch() {},
    async readActivity() {
      return { appraisals: [], simulations: [] };
    },
  };
}

function runtime(repo) {
  let generated = 0;
  return { repository: repo, now: NOW, idGenerator: () => `id-${++generated}` };
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") ?? "";
  const value = /jda_account=([^;]*)/.exec(header)?.[1] ?? "";
  return { header, cookie: `jda_account=${value}`, token: value };
}

async function registeredAccount() {
  const repo = repository();
  const response = await registerAccountResponse(
    jsonRequest("https://jda.test/api/v1/account", "POST", {
      name: "Martín González",
      email: "Martin@Correo.com ",
      phone: "249 458-7046",
      password: PASSWORD,
      acceptedTerms: true,
    }),
    runtime(repo),
  );
  return { repo, response, ...cookieFrom(response) };
}

// ── Núcleo criptográfico ───────────────────────────────────────────────────

test("la contraseña se guarda derivada y se verifica sin conservar el original", async () => {
  const stored = await hashPassword(PASSWORD);

  assert.equal(stored.algorithm, "PBKDF2-SHA256");
  assert.ok(stored.iterations >= 210_000);
  assert.notEqual(stored.hash, PASSWORD);
  assert.ok(!JSON.stringify(stored).includes(PASSWORD));
  assert.deepEqual(await verifyPassword(PASSWORD, stored), { ok: true, needsRehash: false });
  assert.deepEqual(await verifyPassword("otra-clave-larga", stored), {
    ok: false,
    needsRehash: false,
  });
});

test("una cuenta guardada con menos iteraciones pide rehash al ingresar", async () => {
  const legacy = await hashPassword(PASSWORD, { iterations: 50_000 });
  const verification = await verifyPassword(PASSWORD, legacy);

  assert.equal(verification.ok, true);
  assert.equal(verification.needsRehash, true);
});

test("la política rechaza contraseñas cortas, vacías y previsibles", async () => {
  for (const candidate of ["corta", "         ", "password", "12345678"]) {
    await assert.rejects(
      () => hashPassword(candidate),
      (error) => error.code === "INVALID_PASSWORD",
      candidate,
    );
  }
});

test("el correo se normaliza y las formas inválidas se rechazan", () => {
  assert.equal(normalizeEmail("  Martin@Correo.COM "), "martin@correo.com");
  for (const candidate of ["sin-arroba", "a@b", "@correo.com", "x".repeat(300)]) {
    assert.throws(() => normalizeEmail(candidate), (error) => error.code === "INVALID_EMAIL");
  }
});

test("la comparación de secretos no se corta en el primer byte distinto", () => {
  assert.equal(timingSafeEqual("abcdef", "abcdef"), true);
  assert.equal(timingSafeEqual("abcdef", "abcdeg"), false);
  assert.equal(timingSafeEqual("abcdef", "abcde"), false);
  assert.equal(timingSafeEqual("abc", 123), false);
});

test("de la sesión sólo se persiste el hash y la cookie viaja protegida", async () => {
  const session = await createSessionToken(NOW);

  assert.equal(session.tokenHash.length, 64);
  assert.notEqual(session.tokenHash, session.token);
  assert.equal(await hashSessionToken(session.token), session.tokenHash);

  const cookie = sessionCookie({ token: session.token, expiresAt: session.expiresAt });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
  // En http:// local el navegador descartaría una cookie Secure.
  assert.doesNotMatch(
    sessionCookie({ token: session.token, expiresAt: session.expiresAt, secure: false }),
    /Secure/,
  );
  assert.match(clearedSessionCookie(), /Max-Age=0/);

  assert.equal(readSessionCookie(`otra=1; jda_account=${session.token}; x=2`), session.token);
  assert.equal(readSessionCookie("jda_account=corta"), null);
  assert.equal(readSessionCookie(null), null);
});

test("una sesión vencida o revocada deja de servir", async () => {
  const session = await createSessionToken(NOW);
  assert.equal(isSessionUsable({ ...session, revokedAt: null }, NOW), true);
  assert.equal(isSessionUsable({ ...session, revokedAt: NOW.toISOString() }, NOW), false);
  assert.equal(
    isSessionUsable({ expiresAt: NOW.toISOString(), revokedAt: null }, NOW),
    false,
  );
});

test("el bloqueo por intentos se activa recién al agotar el margen", () => {
  let account = { failedAttempts: 0, lockedUntil: null };
  for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
    account = nextFailureState(account, NOW);
    assert.equal(account.lockedUntil, null, `intento ${attempt}`);
  }
  const locked = nextFailureState(account, NOW);
  assert.equal(locked.failedAttempts, MAX_FAILED_ATTEMPTS);
  assert.ok(locked.lockedUntil);
  assert.equal(isAccountLocked(locked, NOW), true);
  assert.equal(isAccountLocked(locked, new Date(NOW.getTime() + 60 * 60_000)), false);
});

// ── Registro, ingreso y salida ─────────────────────────────────────────────

test("el alta crea la cuenta, normaliza el correo y abre sesión", async () => {
  const { repo, response, header, token } = await registeredAccount();
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.email, "martin@correo.com");
  assert.equal(body.data.name, "Martín González");
  assert.match(header, /HttpOnly/);
  assert.ok(token.length >= 40);
  // La respuesta nunca devuelve material secreto.
  assert.ok(!JSON.stringify(body).includes(PASSWORD));
  assert.equal(repo.state.accounts.size, 1);
  assert.equal(repo.state.sessions.size, 1);
});

test("registrarse con un correo permitido no concede panel sin el ID autorizado", async () => {
  const { repo, cookie, token } = await registeredAccount();
  const session = await repo.findSessionAccount(
    await hashSessionToken(token),
    NOW.toISOString(),
  );
  assert.ok(session);

  const readSession = async () => session.account;
  await assert.rejects(
    () => requirePanelUser("/panel", {
      cookieHeader: cookie,
      allowedEmails: "martin@correo.com",
      allowedAccountIds: "admin-account-id",
      readSession,
    }),
    (error) => error instanceof PanelAccessError && error.code === "PANEL_ACCESS_DENIED",
  );

  const panelUser = await requirePanelUser("/panel", {
    cookieHeader: cookie,
    allowedEmails: "martin@correo.com",
    allowedAccountIds: session.account.id,
    readSession,
  });
  assert.equal(panelUser.userId, session.account.id);
  assert.equal(panelUser.normalizedEmail, "martin@correo.com");
});

test("el alta exige aceptar los términos y rechaza el correo repetido", async () => {
  const { repo } = await registeredAccount();

  const withoutConsent = await registerAccountResponse(
    jsonRequest("https://jda.test/api/v1/account", "POST", {
      name: "Otra Persona",
      email: "otra@correo.com",
      password: PASSWORD,
      acceptedTerms: false,
    }),
    runtime(repo),
  );
  assert.equal(withoutConsent.status, 422);
  assert.equal((await withoutConsent.json()).error.fields.acceptedTerms.length > 0, true);

  const duplicated = await registerAccountResponse(
    jsonRequest("https://jda.test/api/v1/account", "POST", {
      name: "Martín Repetido",
      email: "martin@correo.com",
      password: PASSWORD,
      acceptedTerms: true,
    }),
    runtime(repo),
  );
  assert.equal(duplicated.status, 409);
  assert.equal((await duplicated.json()).error.code, "EMAIL_ALREADY_REGISTERED");
});

test("el ingreso responde igual ante correo inexistente y contraseña incorrecta", async () => {
  const { repo } = await registeredAccount();

  const unknownEmail = await loginResponse(
    jsonRequest("https://jda.test/api/v1/account/sessions", "POST", {
      email: "nadie@correo.com",
      password: PASSWORD,
    }),
    runtime(repo),
  );
  const wrongPassword = await loginResponse(
    jsonRequest("https://jda.test/api/v1/account/sessions", "POST", {
      email: "martin@correo.com",
      password: "otra-clave-larga-9999",
    }),
    runtime(repo),
  );

  assert.equal(unknownEmail.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await unknownEmail.json(), await wrongPassword.json());
  assert.equal(unknownEmail.headers.get("set-cookie"), null);
});

test("la cuenta se bloquea sola tras insistir con la contraseña", async () => {
  const { repo } = await registeredAccount();
  const attempt = () =>
    loginResponse(
      jsonRequest("https://jda.test/api/v1/account/sessions", "POST", {
        email: "martin@correo.com",
        password: "clave-incorrecta-01",
      }),
      runtime(repo),
    );

  for (let index = 0; index < MAX_FAILED_ATTEMPTS; index += 1) await attempt();

  const locked = await loginResponse(
    jsonRequest("https://jda.test/api/v1/account/sessions", "POST", {
      email: "martin@correo.com",
      password: PASSWORD,
    }),
    runtime(repo),
  );
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).error.code, "ACCOUNT_TEMPORARILY_LOCKED");
});

test("cerrar sesión revoca el token y limpia la cookie", async () => {
  const { repo, cookie } = await registeredAccount();

  const response = await logoutResponse(
    new Request("https://jda.test/api/v1/account/sessions", { method: "DELETE", headers: { cookie } }),
    runtime(repo),
  );
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const afterLogout = await accountFavoritesResponse(
    new Request("https://jda.test/api/v1/account/favorites", { headers: { cookie } }),
    runtime(repo),
  );
  assert.equal(afterLogout.status, 401);
});

// ── Rutas privadas ─────────────────────────────────────────────────────────

test("sin sesión válida las rutas de la cuenta fallan cerradas", async () => {
  const repo = repository();
  for (const cookie of [undefined, "jda_account=token-inventado-que-no-existe-en-la-base"]) {
    const response = await accountPreferencesResponse(
      new Request("https://jda.test/api/v1/account/preferences", { headers: cookie ? { cookie } : {} }),
      runtime(repo),
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "ACCOUNT_SESSION_REQUIRED");
  }
});

test("las preferencias guardan presupuesto, cuota y gustos declarados", async () => {
  const { repo, cookie } = await registeredAccount();

  const saved = await accountPreferencesResponse(
    jsonRequest(
      "https://jda.test/api/v1/account/preferences",
      "PUT",
      {
        budgetCents: 8_000_000_00,
        maxMonthlyPaymentCents: 600_000_00,
        preferredMakes: ["Toyota", "Toyota", "  Volkswagen  ", ""],
        preferredBodyTypes: ["suv", "pickup"],
        currentVehicle: { make: "Fiat", model: "Cronos", year: 2019, mileageKm: 90_000 },
      },
      cookie,
    ),
    runtime(repo),
  );
  const body = await saved.json();

  assert.equal(saved.status, 200);
  assert.equal(body.data.budgetCents, 800_000_000);
  assert.deepEqual(body.data.preferredMakes, ["Toyota", "Volkswagen"]);
  assert.deepEqual(body.data.preferredBodyTypes, ["suv", "pickup"]);
  assert.equal(body.data.currentVehicle.model, "Cronos");
});

test("los favoritos sólo aceptan una unidad publicada y no se duplican", async () => {
  const { repo, cookie } = await registeredAccount();
  const add = (vehicleId) =>
    accountFavoritesResponse(
      jsonRequest("https://jda.test/api/v1/account/favorites", "POST", { vehicleId }, cookie),
      runtime(repo),
    );

  assert.equal((await add("veh-tcross-2022")).status, 201);
  assert.equal((await add("veh-tcross-2022")).status, 201);
  assert.equal((await add("vehicle-inexistente")).status, 404);

  const [accountId] = repo.state.accounts.keys();
  assert.equal(repo.state.favorites.get(accountId).length, 1);
});

// ── Alcance declarado ──────────────────────────────────────────────────────

test("la cuenta es opcional: ninguna superficie del flujo principal la exige", async () => {
  const pages = [
    "app/page.tsx",
    "app/stock/page.tsx",
    "app/autos/[slug]/page.tsx",
    "app/tasar-mi-usado/page.tsx",
    "app/que-auto-me-llevo/page.tsx",
    "app/oferta-del-dia/page.tsx",
  ];
  for (const path of pages) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /readAccountDashboard|requireSession/, path);
    assert.doesNotMatch(source, /redirect\("\/cuenta/, path);
  }

  // La privada sí manda a ingresar antes de mostrar nada.
  const account = await readFile(new URL("app/cuenta/page.tsx", root), "utf8");
  assert.match(account, /redirect\("\/cuenta\/ingresar"\)/);
  assert.match(account, /index: false, follow: false/);
});

test("el ingreso y el alta pasan por el limitador de abuso por IP", async () => {
  const [register, sessions, limits] = await Promise.all([
    readFile(new URL("app/api/v1/account/route.ts", root), "utf8"),
    readFile(new URL("app/api/v1/account/sessions/route.ts", root), "utf8"),
    readFile(new URL("lib/server/rate-limit.ts", root), "utf8"),
  ]);
  assert.match(register, /withRateLimit\("public\.account-register"/);
  assert.match(sessions, /withRateLimit\("public\.account-login"/);
  assert.match(limits, /"public\.account-register": \{ limit: \d+/);
  assert.match(limits, /"public\.account-login": \{ limit: \d+/);
});
