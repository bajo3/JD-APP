type AuthenticatedChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

type RequireUser = (returnTo: string) => Promise<AuthenticatedChatGPTUser>;

export type PanelUser = Readonly<
  AuthenticatedChatGPTUser & {
    normalizedEmail: string;
  }
>;

export type PanelAccessErrorCode =
  | "PANEL_ACCESS_NOT_CONFIGURED"
  | "PANEL_ACCESS_DENIED";

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

type PanelAuthDependencies = {
  allowedEmails?: string | undefined;
  requireUser?: RequireUser;
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
 * Authenticates through the starter SIWC helper, then applies the independent
 * business allowlist. The SIWC helper owns sign-in and callback behavior.
 */
export async function requirePanelUser(
  returnTo = "/panel",
  dependencies: PanelAuthDependencies = {},
): Promise<PanelUser> {
  let requireUser = dependencies.requireUser;
  if (!requireUser) {
    const chatGPTAuth = await import("../../app/chatgpt-auth");
    requireUser = chatGPTAuth.requireChatGPTUser;
  }

  // Authentication runs first so anonymous requests follow the starter's SIWC
  // redirect. Do not catch its redirect response here.
  const user = await requireUser(returnTo);
  const configuredValue =
    dependencies.allowedEmails ?? process.env.PANEL_ALLOWED_EMAILS;
  if (!isPanelEmailAllowed(user.email, configuredValue)) {
    throw new PanelAccessError("PANEL_ACCESS_DENIED");
  }

  return Object.freeze({
    ...user,
    normalizedEmail: normalizeEmail(user.email),
  });
}

function normalizeEmail(value: string): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
