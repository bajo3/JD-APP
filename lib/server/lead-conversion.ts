import {
  CrmContractError,
  fingerprintContextualLeadCommand,
  normalizeContextualLeadContext,
  sha256Canonical,
  validateContextualConversion,
} from "@/lib/crm/index.mjs";
import type {
  LeadConversionRepository,
  ContextualSelection,
} from "@/lib/data/lead-conversion-repository";
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

type CrmContext = Readonly<{ simulationCode: string; vehicleSlug: string }>;

export type LeadConversionRuntime = Readonly<{
  access?: DataAccess;
  repository?: LeadConversionRepository;
  now?: Date;
  idGenerator?: () => string;
}>;

function crmError(error: CrmContractError): never {
  const status = error.code === "CRM_SIMULATION_ALREADY_LINKED" ? 409 : 422;
  throw new ApiError(status, error.code, error.message, {
    ...(error.field ? { [error.field]: error.code } : {}),
  });
}

function normalizeContext(payload: Record<string, unknown>): CrmContext | null {
  try {
    return normalizeContextualLeadContext({
      simulationCode: payload.simulationCode,
      vehicleSlug: payload.vehicleSlug,
    }) as CrmContext | null;
  } catch (error) {
    if (error instanceof CrmContractError) crmError(error);
    throw error;
  }
}

async function commandHash(input: {
  name: string;
  phoneNormalized: string;
  email: string | null;
  source: string;
  privacyPolicyVersion: string | null;
  context: CrmContext | null;
}): Promise<{ commandHash: string; contextHash: string | null }> {
  try {
    if (input.context) {
      const crm = await fingerprintContextualLeadCommand({
        identity: { name: input.name, phoneNormalized: input.phoneNormalized },
        command: {
          contactConsent: true,
          source: input.source,
          ...input.context,
        },
      });
      return {
        contextHash: String(crm.contextHash),
        commandHash: await sha256Canonical({
          schemaVersion: "jda-crm.v1.public-lead-command.v1",
          crmCommandHash: crm.commandHash,
          email: input.email,
          privacyPolicyVersion: input.privacyPolicyVersion,
        }),
      };
    }
    return {
      contextHash: null,
      commandHash: await sha256Canonical({
        schemaVersion: "jda-crm.v1.public-lead-command.v1",
        identity: {
          name: input.name,
          phoneNormalized: input.phoneNormalized,
          email: input.email,
        },
        command: {
          contactConsent: true,
          source: input.source,
          privacyPolicyVersion: input.privacyPolicyVersion,
          context: null,
        },
      }),
    };
  } catch (error) {
    if (error instanceof CrmContractError) crmError(error);
    throw error;
  }
}

function repositoryError(reason: string): never {
  if (reason === "idempotency_conflict") {
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "La clave ya fue usada para otro contacto u operación.",
    );
  }
  if (reason === "simulation_already_linked") {
    throw new ApiError(
      409,
      "CRM_SIMULATION_ALREADY_LINKED",
      "La simulación ya está vinculada a otro contacto.",
    );
  }
  if (reason === "simulation_not_found") {
    throw new ApiError(404, "SIMULATION_NOT_FOUND", "No encontramos la simulación.");
  }
  throw new ApiError(
    409,
    "CRM_CONTEXT_MISMATCH",
    "La simulación y la unidad no coinciden con la operación guardada.",
  );
}

export function createLeadResponse(
  request: Request,
  runtime: LeadConversionRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    if (payload.contactConsent !== true) {
      throw new ApiError(
        422,
        "CONTACT_CONSENT_REQUIRED",
        "Necesitamos tu permiso para responder la consulta.",
        { contactConsent: "Debe aceptarse para enviar la consulta." },
      );
    }
    const name = requiredString(payload, "name", { min: 2, max: 120 });
    const phoneNormalized = normalizePhone(
      requiredString(payload, "phone", { min: 8, max: 40 }),
    );
    const email = optionalString(payload, "email", 254) ?? null;
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
    const privacyPolicyVersion = optionalString(payload, "privacyPolicyVersion", 64) ?? null;
    const context = normalizeContext(payload);
    const fingerprint = await commandHash({
      name,
      phoneNormalized,
      email,
      source,
      privacyPolicyVersion,
      context,
    });

    const access = runtime.access ?? getDataAccess();
    const repository = runtime.repository ?? access.leadConversions;
    const existing = await repository.findLeadByIdempotencyKey(idempotencyKey);
    if (existing && existing.createRequestHash !== fingerprint.commandHash) {
      repositoryError("idempotency_conflict");
    }
    const leadId = existing?.id ?? runtime.idGenerator?.() ?? crypto.randomUUID();
    let selection: ContextualSelection | null = null;
    if (context) {
      if (existing) {
        const replayLink = await repository.findLinkedContext({
          leadId: existing.id,
          simulationCode: context.simulationCode,
          vehicleSlug: context.vehicleSlug,
        });
        if (!replayLink) repositoryError("context_mismatch");
        selection = {
          interestId: `interest-${await stableToken(`${leadId}:${replayLink.simulationId}`, 24)}`,
          simulationId: replayLink.simulationId,
          simulationCode: replayLink.simulationCode,
          vehicleId: replayLink.vehicleId,
          vehicleSlug: replayLink.vehicleSlug,
          promotionId: replayLink.promotionId,
          contextJson: "{}",
        };
      } else {
      const [simulation, vehicle] = await Promise.all([
        access.simulations.findByPublicCode(context.simulationCode),
        access.stock.findBySlug(context.vehicleSlug),
      ]);
      if (!simulation) {
        throw new ApiError(404, "SIMULATION_NOT_FOUND", "No encontramos la simulación.");
      }
      if (!vehicle) {
        throw new ApiError(404, "VEHICLE_NOT_FOUND", "La unidad ya no está disponible.");
      }
      let validated;
      try {
        validated = validateContextualConversion({
          leadId,
          simulationCode: context.simulationCode,
          vehicleSlug: context.vehicleSlug,
          simulation,
          vehicle,
        });
      } catch (error) {
        if (error instanceof CrmContractError) crmError(error);
        throw error;
      }
      selection = {
        interestId: `interest-${await stableToken(`${leadId}:${validated.simulationId}`, 24)}`,
        simulationId: String(validated.simulationId),
        simulationCode: String(validated.simulationCode),
        vehicleId: String(validated.vehicleId),
        vehicleSlug: String(validated.vehicleSlug),
        promotionId:
          validated.promotionId === null ? null : String(validated.promotionId),
        contextJson: JSON.stringify({
          schemaVersion: validated.schemaVersion,
          source,
          simulationCode: validated.simulationCode,
          vehicleSlug: validated.vehicleSlug,
          promotionId: validated.promotionId,
          contextHash: fingerprint.contextHash,
        }),
      };
      }
    }

    const occurredAt = (runtime.now ?? new Date()).toISOString();
    const result = await repository.create({
      leadId,
      idempotencyKey,
      requestHash: fingerprint.commandHash,
      name,
      phoneNormalized,
      email,
      source,
      occurredAt,
      consentId: `consent-${await stableToken(`${leadId}:contact-request`, 24)}`,
      consentChannel: "WHATSAPP_OR_PHONE",
      consentPurpose: "CONTACT_REQUEST",
      consentEvidenceJson: JSON.stringify({
        method: "api_v1",
        privacyPolicyVersion,
      }),
      context: selection,
    });
    if (!result.ok) repositoryError(result.reason);
    return json(
      {
        data: {
          id: result.lead.id,
          status: result.lead.status,
          createdAt: result.lead.createdAt,
        },
        meta: {
          ...sourceMeta(access.source),
          idempotencyReplayed: result.replayed,
        },
      },
      {
        status: result.replayed ? 200 : 201,
        headers: result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
