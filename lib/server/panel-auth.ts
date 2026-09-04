import type { CustomerAccountRecord } from "@/lib/data/customer-account-repository";

type AuthenticatedPanelUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type ReadAccountSession = (
  cookieHeader: string | null,
) => Promise<CustomerAccountRecord | null>;

export type PanelUser = Readonly<
  AuthenticatedPanelUser & {
    normalizedEmail: string;
  }
>;

export type PanelAccessErrorCode =
  | "PANEL_ACCESS_NOT_CONFIGURED"
  | "PANEL_ACCESS_DENIED";

/** Señal sin dependencia de UI: el layout del panel decide cómo redirigir. */
export class PanelAuthenticationRequired extends Error {
  readonly returnTo: string;

  constructor(returnTo: string) {
    super("Iniciá sesión para usar el panel interno.");
    this.name = "PanelAuthenticationRequired";
    this.returnTo = returnTo;
  }
}

export class PanelAccessError extends Error {
  readonly code: PanelAccessErrorCode;

  constructor(code: PanelAccessErrorCode) {
    super(
      code === "PANEL_ACCESS_NOT_CONFIGURED"
        ? "El panel interno no está disponible."
        : "No tenés acceso autorizado al panel interno.",
    );
    this.name = "PanelAccessError";
    this.code = code;
  }
}

export type PanelAuthDependencies = {
  allowedEmails?: string | undefined;
  readSession?: ReadAccountSession;
  cookieHeader?: string | null;
  redirect?: (destination: string) => never;
};

const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Reads the server-only allowlist. Missing, blank or malformed configuration
 * intentionally throws instead of granting partial access.
 */
export function parsePanelAllowedEmails(
  configuredValue: string | undefined,
): readonly string[] {
  if (!configuredValue?.trim()) {
    throw new PanelAccessError("PANEL_ACCESS_NOT_CONFIGURED");
  }

  const rawEntries = configuredValue.split(",");
  const normalized = rawEntries.map(normalizeEmail);
  if (
    normalized.some((email) => !email || !EMAIL_PATTERN.test(email)) ||
    normalized.length === 0
  ) {
    throw new PanelAccessError("PANEL_ACCESS_NOT_CONFIGURED");
  }

  return Object.freeze([...new Set(normalized)]);
}

export function isPanelEmailAllowed(
  email: string,
  configuredValue: string | undefined,
): boolean {
  const allowlist = parsePanelAllowedEmails(configuredValue);
  const normalizedEmail = normalizeEmail(email);
  return EMAIL_PATTERN.test(normalizedEmail) && allowlist.includes(normalizedEmail);
}

/**
 * La identidad del panel es una sesión propia de cuenta, guardada en una
 * cookie HttpOnly. La allowlist sigue siendo una segunda barrera independiente:
 * tener una cuenta no concede acceso interno por sí solo.
 */
export async function requirePanelUser(
  returnTo = "/panel",
  dependencies: PanelAuthDependencies = {},
): Promise<PanelUser> {
  const cookieHeader = dependencies.cookieHeader !== undefined
    ? dependencies.cookieHeader
    : dependencies.readSession
      ? null
      : await currentCookieHeader();
  const account = await (dependencies.readSession ?? readCurrentAccount)(
    cookieHeader,
  );
  if (!account) {
    const destination = safeReturnTo(returnTo);
    if (dependencies.redirect) return dependencies.redirect(destination);
    throw new PanelAuthenticationRequired(destination);
  }

  const configuredValue =
    dependencies.allowedEmails ?? process.env.PANEL_ALLOWED_EMAILS;
  if (!isPanelEmailAllowed(account.email, configuredValue)) {
    throw new PanelAccessError("PANEL_ACCESS_DENIED");
  }

  return Object.freeze({
    userId: account.id,
    displayName: account.name.trim() || account.email,
    email: account.email,
    fullName: null,
    normalizedEmail: normalizeEmail(account.email),
  });
}

async function currentCookieHeader(): Promise<string | null> {
  const { headers } = await import("next/headers");
  return (await headers()).get("cookie");
}

async function readCurrentAccount(cookieHeader: string | null): Promise<CustomerAccountRecord | null> {
  const { readAccountSessionFromCookie } = await import("./account-api");
  return readAccountSessionFromCookie(cookieHeader);
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/panel";
}

function normalizeEmail(value: string): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
