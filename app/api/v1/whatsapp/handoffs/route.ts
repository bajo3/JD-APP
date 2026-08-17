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
    const access = getDataAccess();
    const profile = await access.businessProfile.get();
    if (!profile?.whatsappE164 || !/^\+[1-9]\d{7,14}$/.test(profile.whatsappE164)) {
      throw new ApiError(
        409,
        "WHATSAPP_NOT_CONFIGURED",
        "El canal de WhatsApp todavía no está confirmado por el negocio.",
      );
    }

    const leadId = optionalString(payload, "leadId", 80);
    let lead = leadId ? await access.leads.findById(leadId) : null;
    let replayed = false;
    if (leadId && !lead) {
      throw new ApiError(404, "LEAD_NOT_FOUND", "No encontramos el contacto asociado.");
    }
    if (!lead) {
      if (payload.contactConsent !== true) {
        throw new ApiError(422, "CONTACT_CONSENT_REQUIRED", "Necesitamos tu permiso para iniciar el contacto.", {
          contactConsent: "Debe aceptarse para abrir el canal de WhatsApp.",
        });
      }
      const id = crypto.randomUUID();
      lead = await access.leads.create({
        id,
        idempotencyKey: `handoff:${idempotencyKey}`,
        name: requiredString(payload, "name", { min: 2, max: 120 }),
        phoneNormalized: normalizePhone(requiredString(payload, "phone", { min: 8, max: 40 })),
        source: optionalString(payload, "source", 64) ?? "WHATSAPP_HANDOFF",
        status: "NEW",
      });
      replayed = lead.id !== id;
      await access.recordConsent({
        id: `consent-${await stableToken(`${lead.id}:contact-request`, 24)}`,
        leadId: lead.id,
        channel: "WHATSAPP",
        purpose: "CONTACT_REQUEST",
        grantedAt: new Date().toISOString(),
        evidence: { method: "api_v1_whatsapp_handoff" },
      });
    }

    const vehicleSlug = optionalString(payload, "vehicleSlug", 120);
    const simulationCode = optionalString(payload, "simulationCode", 40);
    const vehicle = vehicleSlug ? await access.stock.findBySlug(vehicleSlug) : null;
    if (vehicleSlug && !vehicle) {
      throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    }
    const simulation = simulationCode
      ? await access.simulations.findByPublicCode(simulationCode.toUpperCase())
      : null;
    if (simulationCode && !simulation) {
      throw new ApiError(404, "SIMULATION_NOT_FOUND", "No encontramos la simulación.");
    }

    const handoffCode = `JD-${await stableToken(`handoff:${idempotencyKey}`, 6)}`;
    const subject = vehicle
      ? `${vehicle.make} ${vehicle.model} ${vehicle.year}`
      : "una operación";
    const operationCode = simulation?.publicCode ?? handoffCode;
    const message = `Hola, me interesa ${subject}. Mi operación JD: ${operationCode}`;
    const url = `https://wa.me/${profile.whatsappE164.slice(1)}?text=${encodeURIComponent(message)}`;
    const occurredAt = new Date().toISOString();
    const eventCreated = await access.recordLeadEvent({
      id: `handoff-${await stableToken(idempotencyKey, 24)}`,
      leadId: lead.id,
      type: "WHATSAPP_HANDOFF_CREATED",
      occurredAt,
      metadata: {
        handoffCode,
        vehicleId: vehicle?.id ?? null,
        simulationId: simulation?.id ?? null,
        mode: "CLICK_TO_CHAT",
      },
    });
    replayed ||= !eventCreated;

    return json(
      {
        data: {
          code: handoffCode,
          mode: "CLICK_TO_CHAT",
          url,
          leadId: lead.id,
          simulationCode: simulation?.publicCode ?? null,
        },
        meta: { ...sourceMeta(access.source), idempotencyReplayed: replayed },
      },
      {
        status: replayed ? 200 : 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
