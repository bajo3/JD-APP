import {
  CrmContractError,
  normalizeContextualLeadContext,
  sha256Canonical,
} from "@/lib/crm/index.mjs";
import type { LeadConversionRepository } from "@/lib/data/lead-conversion-repository";
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
} from "./api";
import { getDataAccess, sourceMeta, type DataAccess } from "./data-access";

type HandoffContext = Readonly<{ simulationCode: string; vehicleSlug: string }>;

export type WhatsappHandoffRuntime = Readonly<{
  access?: DataAccess;
  repository?: LeadConversionRepository;
  now?: Date;
  idGenerator?: () => string;
}>;

function contextFrom(payload: Record<string, unknown>): HandoffContext | null {
  try {
    return normalizeContextualLeadContext({
      simulationCode: payload.simulationCode,
      vehicleSlug: payload.vehicleSlug,
    }) as HandoffContext | null;
  } catch (error) {
    if (error instanceof CrmContractError) {
      throw new ApiError(422, error.code, error.message, {
        ...(error.field ? { [error.field]: error.code } : {}),
      });
    }
    throw error;
  }
}

export function createWhatsappHandoffResponse(
  request: Request,
  runtime: WhatsappHandoffRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    const access = runtime.access ?? getDataAccess();
    const repository = runtime.repository ?? access.leadConversions;
    const context = contextFrom(payload);
    const source = optionalString(payload, "source", 64) ?? "WHATSAPP_HANDOFF";
    const suppliedLeadId = optionalString(payload, "leadId", 80);
    let lead = suppliedLeadId ? await access.leads.findById(suppliedLeadId) : null;
    let leadReplay = false;
    if (suppliedLeadId && !lead) {
      throw new ApiError(404, "LEAD_NOT_FOUND", "No encontramos el contacto asociado.");
    }
    if (context && !suppliedLeadId) {
      throw new ApiError(
        422,
        "CRM_CONTEXT_REQUIRES_LEAD",
        "La operación debe guardarse antes de abrir WhatsApp.",
        { leadId: "Guardá el contacto asociado a la simulación." },
      );
    }

    let linked = null;
    if (context && suppliedLeadId) {
      linked = await repository.findLinkedContext({
        leadId: suppliedLeadId,
        simulationCode: context.simulationCode,
        vehicleSlug: context.vehicleSlug,
      });
      if (!linked) {
        throw new ApiError(
          409,
          "CRM_CONTEXT_NOT_LINKED",
          "La simulación todavía no está vinculada a este contacto y unidad.",
        );
      }
    }

    if (!lead) {
      if (payload.contactConsent !== true) {
        throw new ApiError(
          422,
          "CONTACT_CONSENT_REQUIRED",
          "Necesitamos tu permiso para iniciar el contacto.",
          { contactConsent: "Debe aceptarse para abrir el canal de WhatsApp." },
        );
      }
      const id = runtime.idGenerator?.() ?? crypto.randomUUID();
      lead = await access.leads.create({
        id,
        idempotencyKey: `handoff:${idempotencyKey}`,
        createRequestHash: null,
        name: requiredString(payload, "name", { min: 2, max: 120 }),
        phoneNormalized: normalizePhone(
          requiredString(payload, "phone", { min: 8, max: 40 }),
        ),
        source,
        status: "NEW",
      });
      leadReplay = lead.id !== id;
      await access.recordConsent({
        id: `consent-${await stableToken(`${lead.id}:contact-request`, 24)}`,
        leadId: lead.id,
        channel: "WHATSAPP",
        purpose: "CONTACT_REQUEST",
        grantedAt: (runtime.now ?? new Date()).toISOString(),
        evidence: { method: "api_v1_whatsapp_handoff" },
      });
    }

    const profile = await access.businessProfile.get();
    if (!profile?.whatsappE164 || !/^\+[1-9]\d{7,14}$/.test(profile.whatsappE164)) {
      throw new ApiError(
        409,
        "WHATSAPP_NOT_CONFIGURED",
        "El canal de WhatsApp todavía no está confirmado por el negocio.",
      );
    }

    const handoffCode = `JD-${await stableToken(`handoff:${idempotencyKey}`, 6)}`;
    const subject = linked
      ? `${linked.vehicleLabel} ${linked.vehicleYear}`
      : "una operación";
    const operationCode = linked?.simulationCode ?? handoffCode;
    const message = `Hola, me interesa ${subject}. Mi operación JD: ${operationCode}`;
    const url = `https://wa.me/${profile.whatsappE164.slice(1)}?text=${encodeURIComponent(message)}`;
    const occurredAt = (runtime.now ?? new Date()).toISOString();
    let eventReplayed = false;

    if (linked) {
      const requestHash = await sha256Canonical({
        schemaVersion: "jda-crm.v1.whatsapp-handoff.v1",
        leadId: lead.id,
        simulationCode: linked.simulationCode,
        vehicleSlug: linked.vehicleSlug,
        source,
      });
      const event = await repository.recordHandoff({
        eventId: `handoff-${await stableToken(idempotencyKey, 24)}`,
        leadId: lead.id,
        simulationId: linked.simulationId,
        simulationCode: linked.simulationCode,
        vehicleId: linked.vehicleId,
        vehicleSlug: linked.vehicleSlug,
        requestHash,
        occurredAt,
        metadata: {
          handoffCode,
          vehicleId: linked.vehicleId,
          simulationId: linked.simulationId,
          mode: "CLICK_TO_CHAT",
        },
      });
      if (!event.ok) {
        throw new ApiError(
          409,
          event.reason === "idempotency_conflict"
            ? "IDEMPOTENCY_CONFLICT"
            : "CRM_CONTEXT_NOT_LINKED",
          event.reason === "idempotency_conflict"
            ? "La clave ya fue usada para otro handoff."
            : "La operación dejó de estar vinculada a este contacto.",
        );
      }
      eventReplayed = event.replayed;
    } else {
      const eventCreated = await access.recordLeadEvent({
        id: `handoff-${await stableToken(idempotencyKey, 24)}`,
        leadId: lead.id,
        type: "WHATSAPP_HANDOFF_CREATED",
        occurredAt,
        metadata: { handoffCode, vehicleId: null, simulationId: null, mode: "CLICK_TO_CHAT" },
      });
      eventReplayed = !eventCreated;
    }

    const replayed = leadReplay || eventReplayed;
    return json(
      {
        data: {
          code: handoffCode,
          mode: "CLICK_TO_CHAT",
          url,
          leadId: lead.id,
          simulationCode: linked?.simulationCode ?? null,
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
