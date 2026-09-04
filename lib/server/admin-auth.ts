import { ApiError } from "./api";
import { PanelAccessError, parsePanelAllowedEmails } from "./panel-auth";
import type { CustomerAccountRecord } from "@/lib/data/customer-account-repository";

export type AdminApiActor = Readonly<{
  userId: string;
  email: string;
  displayName: string;
}>;

export type AdminAuthOptions = {
  allowedEmails?: string;
  readSession?: (cookieHeader: string | null) => Promise<CustomerAccountRecord | null>;
};

export async function authenticateAdminRequest(
  request: Request,
  options: AdminAuthOptions = {},
): Promise<AdminApiActor> {
  const account = await (options.readSession ?? readCurrentAccount)(
    request.headers.get("cookie"),
  );
  if (!account) {
    throw new ApiError(401, "ADMIN_AUTH_REQUIRED", "Iniciá sesión para usar el panel interno.");
  }
  const email = account.email.trim().toLowerCase();

  let allowed: readonly string[];
  try {
    allowed = parsePanelAllowedEmails(options.allowedEmails ?? process.env.PANEL_ALLOWED_EMAILS);
  } catch (error) {
    if (error instanceof PanelAccessError) {
      throw new ApiError(
        503,
        "ADMIN_ACCESS_NOT_CONFIGURED",
        "El acceso al panel interno todavía no está configurado.",
      );
    }
    throw error;
  }
  if (!allowed.includes(email)) {
    throw new ApiError(403, "ADMIN_FORBIDDEN", "No tenés permisos para esta operación.");
  }

  return Object.freeze({
    userId: account.id,
    email,
    displayName: account.name.trim() || email,
  });
}

async function readCurrentAccount(cookieHeader: string | null): Promise<CustomerAccountRecord | null> {
  const { readAccountSessionFromCookie } = await import("./account-api");
  return readAccountSessionFromCookie(cookieHeader);
}
