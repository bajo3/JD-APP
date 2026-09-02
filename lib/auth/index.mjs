/**
 * Autenticación de la cuenta del cliente.
 *
 * Este módulo no conoce D1 ni Next.js: recibe y devuelve valores. Usa sólo
 * WebCrypto, así que corre igual en el Worker y en Node.
 *
 * Decisiones que sostienen el resto del circuito:
 * - La contraseña se deriva con PBKDF2-HMAC-SHA256 y sal aleatoria por cuenta.
 *   El registro guarda el número de iteraciones usado, así que subir el costo
 *   más adelante no invalida las cuentas existentes: cada una se verifica con
 *   el suyo y se rehashea al iniciar sesión.
 * - La sesión es un capability de 256 bits. De la base sólo sale su SHA-256:
 *   ni la tabla ni los logs ni una respuesta posterior vuelven a tener el token.
 * - Las comparaciones de secretos son de tiempo constante.
 */

export const PASSWORD_ALGORITHM = "PBKDF2-SHA256";
export const PASSWORD_ITERATIONS = 210_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TTL_MINUTES = 60 * 24 * 30;
export const SESSION_COOKIE_NAME = "jda_account";

/** Intentos fallidos seguidos antes de bloquear temporalmente la cuenta. */
export const MAX_FAILED_ATTEMPTS = 8;
export const LOCK_MINUTES = 15;

export class AuthError extends Error {
  constructor(code, message, fields = null) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.fields = fields;
  }
}

// ── Correo ─────────────────────────────────────────────────────────────────

// Deliberadamente conservador: valida forma, no existencia. Un correo que pasa
// esto todavía puede no recibir nada, así que nada del producto depende de que
// el correo sea alcanzable.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw new AuthError("INVALID_EMAIL", "Ingresá un correo válido.", { email: "Formato inválido." });
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 6 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new AuthError("INVALID_EMAIL", "Ingresá un correo válido.", { email: "Formato inválido." });
  }
  return normalized;
}

// ── Contraseña ─────────────────────────────────────────────────────────────

// Bloqueo de las contraseñas que se prueban primero en cualquier ataque. No
// pretende ser exhaustivo: el largo mínimo y el límite de intentos hacen el
// trabajo pesado.
const TRIVIAL_PASSWORDS = new Set([
  "contrasena", "contraseña", "password", "password123", "12345678", "123456789",
  "1234567890", "qwertyuiop", "administrador", "jesusdiaz", "jesusdiaz1",
  "automotores", "tandil2026", "cambiame123", "micontrasena",
]);

export function assertPasswordPolicy(password) {
  if (typeof password !== "string") {
    throw new AuthError("INVALID_PASSWORD", "Elegí una contraseña.", {
      password: "Requerida.",
    });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError("INVALID_PASSWORD", "La contraseña es demasiado corta.", {
      password: `Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    });
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new AuthError("INVALID_PASSWORD", "La contraseña es demasiado larga.", {
      password: `Debe tener como máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    });
  }
  if (password.trim().length === 0) {
    throw new AuthError("INVALID_PASSWORD", "La contraseña no puede ser sólo espacios.", {
      password: "No puede ser sólo espacios.",
    });
  }
  const folded = password.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (TRIVIAL_PASSWORDS.has(folded)) {
    throw new AuthError("INVALID_PASSWORD", "Esa contraseña es demasiado común.", {
      password: "Elegí una menos previsible.",
    });
  }
  return password;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(derived);
}

/**
 * @returns {Promise<{algorithm: string, iterations: number, salt: string, hash: string}>}
 */
export async function hashPassword(password, options = {}) {
  assertPasswordPolicy(password);
  const iterations = options.iterations ?? PASSWORD_ITERATIONS;
  if (!Number.isSafeInteger(iterations) || iterations < 1_000) {
    throw new AuthError("INVALID_HASH_PARAMS", "Parámetros de hash inválidos.");
  }
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await deriveBits(password, salt, iterations);
  return Object.freeze({
    algorithm: PASSWORD_ALGORITHM,
    iterations,
    salt: toBase64(salt),
    hash: toBase64(hash),
  });
}

/** Comparación de tiempo constante: no filtra en qué byte difieren. */
export function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Verifica sin revelar por qué falla. `needsRehash` avisa que la cuenta se
 * guardó con menos iteraciones de las que hoy exige la política.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || !stored || stored.algorithm !== PASSWORD_ALGORITHM) {
    return { ok: false, needsRehash: false };
  }
  if (password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, needsRehash: false };
  }
  let candidate;
  try {
    candidate = await deriveBits(password, fromBase64(stored.salt), stored.iterations);
  } catch {
    return { ok: false, needsRehash: false };
  }
  const ok = timingSafeEqual(toBase64(candidate), stored.hash);
  return { ok, needsRehash: ok && stored.iterations < PASSWORD_ITERATIONS };
}

// ── Sesión ─────────────────────────────────────────────────────────────────

export function generateSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSessionToken(token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) {
    throw new AuthError("INVALID_SESSION_TOKEN", "Sesión inválida.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(now = new Date(), ttlMinutes = SESSION_TTL_MINUTES) {
  const token = generateSessionToken();
  return Object.freeze({
    token,
    tokenHash: await hashSessionToken(token),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
  });
}

export function isSessionUsable(session, now = new Date()) {
  if (!session) return false;
  if (session.revokedAt) return false;
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime();
}

// ── Bloqueo por intentos ───────────────────────────────────────────────────

export function isAccountLocked(account, now = new Date()) {
  if (!account?.lockedUntil) return false;
  const until = Date.parse(account.lockedUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * El bloqueo es temporal y por cuenta; el límite por IP vive aparte. Juntos
 * cubren el ataque a una cuenta puntual y el barrido sobre muchas.
 */
export function nextFailureState(account, now = new Date()) {
  const failedAttempts = (account?.failedAttempts ?? 0) + 1;
  if (failedAttempts < MAX_FAILED_ATTEMPTS) {
    return { failedAttempts, lockedUntil: null };
  }
  return {
    failedAttempts,
    lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(),
  };
}

// ── Cookie ─────────────────────────────────────────────────────────────────

export function readSessionCookie(cookieHeader, name = SESSION_COOKIE_NAME) {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 8_192) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9._~-]{16,200}$/.test(value) ? value : null;
  }
  return null;
}

/**
 * `Secure` queda fuera sólo en http://localhost, donde el navegador lo
 * descartaría y no habría sesión en el preview.
 */
export function sessionCookie({ token, expiresAt, secure = true, name = SESSION_COOKIE_NAME }) {
  const maxAge = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  return [
    `${name}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearedSessionCookie({ secure = true, name = SESSION_COOKIE_NAME } = {}) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export function requestIsSecure(request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}
