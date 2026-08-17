import { ApiError } from "./api";
import { PanelAccessError, parsePanelAllowedEmails } from "./panel-auth";

export type AdminApiActor = Readonly<{
  userId: string;
  email: string;
  displayName: string;
}>;

type AdminAuthOptions = {
  allowedEmails?: string;
};

export function authenticateAdminRequest(
  request: Request,
  options: AdminAuthOptions = {},
): AdminApiActor {
  const userId = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  if (!userId || !email) {
    throw new ApiError(401, "ADMIN_AUTH_REQUIRED", "Iniciá sesión para usar el panel interno.");
  }

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
    userId,
    email,
    displayName: authenticatedDisplayName(request, email),
  });
}

function authenticatedDisplayName(request: Request, fallback: string): string {
  const encoded = request.headers.get("oai-authenticated-user-full-name")?.trim();
  if (
    !encoded ||
    request.headers.get("oai-authenticated-user-full-name-encoding") !==
      "percent-encoded-utf-8"
  ) {
    return fallback;
  }
  try {
    return decodeURIComponent(encoded).trim() || fallback;
  } catch {
    return fallback;
  }
}
