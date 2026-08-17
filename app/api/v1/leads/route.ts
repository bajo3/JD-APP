import {
  ApiError,
  apiRoute,
  json,
  normalizePhone,
  optionalString,
  readJsonObject,
  requireIdempotencyKey,
  requiredString,
  stableToken,
} from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";

export async function POST(request: Request): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    if (payload.contactConsent !== true) {
      throw new ApiError(422, "CONTACT_CONSENT_REQUIRED", "Necesitamos tu permiso para responder la consulta.", {
        contactConsent: "Debe aceptarse para enviar la consulta.",
      });
    }
    const name = requiredString(payload, "name", { min: 2, max: 120 });
    const phoneNormalized = normalizePhone(requiredString(payload, "phone", { min: 8, max: 40 }));
    const email = optionalString(payload, "email", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        email: "Ingresá un correo válido.",
      });
    }
    const source = optionalString(payload, "source", 64) ?? "API";
    if (!/^[A-Za-z0-9_-]+$/.test(source)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        source: "El origen no es válido.",
      });
    }

    const access = getDataAccess();
    const id = crypto.randomUUID();
    const lead = await access.leads.create({
      id,
      idempotencyKey,
      name,
      phoneNormalized,
      email,
      source,
      status: "NEW",
    });
    const replayed = lead.id !== id;
    const grantedAt = new Date().toISOString();
    await access.recordConsent({
      id: `consent-${await stableToken(`${lead.id}:contact-request`, 24)}`,
      leadId: lead.id,
      channel: "WHATSAPP_OR_PHONE",
      purpose: "CONTACT_REQUEST",
      grantedAt,
      evidence: {
        method: "api_v1",
        privacyPolicyVersion:
          typeof payload.privacyPolicyVersion === "string"
            ? payload.privacyPolicyVersion.slice(0, 64)
            : null,
      },
    });

    return json(
      {
        data: { id: lead.id, status: lead.status, createdAt: lead.createdAt },
        meta: { ...sourceMeta(access.source), idempotencyReplayed: replayed },
      },
      {
        status: replayed ? 200 : 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
