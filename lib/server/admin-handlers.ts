import {
  activateAdminPromotion,
  archiveAdminPromotion,
  createAdminPromotion,
  createAdminVehicle,
  createFinanceVersion,
  editAdminVehicle,
  expireAdminPromotion,
  getAdminAppraisal,
  getAdminConsignment,
  getAdminLead,
  getAdminOverview,
  getAdminPromotion,
  getAdminVehicle,
  getFinanceVersion,
  listAdminAppraisals,
  listAdminConsignments,
  listAdminLeads,
  listAdminPromotions,
  listAdminStock,
  listFinanceVersions,
  pauseAdminPromotion,
  reviewAdminAppraisal,
  reviewAdminConsignment,
  scheduleAdminPromotion,
  transitionAdminLead,
  transitionAdminVehicle,
  transitionFinanceVersion,
  type AppraisalStatus,
  type ConsignmentStatus,
  type CreateFinanceVersionInput,
  type CreatePromotionInput,
  type CreateVehicleInput,
  type LeadStatus,
  type VehicleStatus,
} from "@/lib/admin";
import { adminDependencies } from "./admin-adapter";
import { adminApiRoute, adminData, optionalEnum, requiredEnum } from "./admin-api";
import type { AdminApiActor } from "./admin-auth";
import type { ChannelInboxRepositoryLike } from "@/lib/data/channel-inbox-repository";
import type { OutboundRuntime } from "./inbox-outbound";
import {
  ApiError,
  optionalString,
  readJsonObject,
  requireIdempotencyKey,
  requiredInteger,
  requiredString,
} from "./api";

function dependencies(actor: AdminApiActor) {
  return adminDependencies(actor);
}

function statusFilter<T extends string>(request: Request, allowed: readonly T[]): T | undefined {
  const status = new URL(request.url).searchParams.get("status")?.trim();
  if (!status) return undefined;
  if (!allowed.includes(status as T)) {
    throw new ApiError(422, "VALIDATION_ERROR", "El filtro de estado no es válido.");
  }
  return status as T;
}

function limitFilter(request: Request): number | undefined {
  const value = new URL(request.url).searchParams.get("limit");
  if (!value) return undefined;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(422, "VALIDATION_ERROR", "El límite debe estar entre 1 y 100.");
  }
  return limit;
}

function resourceId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) {
    throw new ApiError(400, "INVALID_ADMIN_RESOURCE_ID", "El identificador no es válido.");
  }
  return value;
}

export function adminOverview(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => adminData(await getAdminOverview(dependencies(actor))));
}

export function adminVehicles(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    if (request.method === "GET") {
      const status = statusFilter(request, ["DRAFT", "AVAILABLE", "RESERVED", "SOLD", "PAUSED", "ARCHIVED"] as const);
      const query = new URL(request.url).searchParams.get("query") ?? undefined;
      return adminData(await listAdminStock(dependencies(actor), { status, query, limit: limitFilter(request) }));
    }
    const payload = await readJsonObject(request);
    const input = {
      ...payload,
      idempotencyKey: requireIdempotencyKey(request),
      currency: payload.currency ?? "ARS",
      source: payload.source ?? (payload.isDemo === true ? "DEMO:admin" : "manual"),
    } as unknown as CreateVehicleInput;
    return adminData(await createAdminVehicle(dependencies(actor), input), { status: 201 });
  });
}

/**
 * Guarda qué compradores estaban esperando una unidad que se acaba de
 * publicar. Nunca hace fallar la publicación: si el cruce falla, la unidad
 * queda publicada igual y el panel se queda sin esas coincidencias hasta el
 * próximo intento; al revés sería peor.
 */
async function recordDemandMatches(vehicle: {
  id: string;
  make: string;
  model: string;
  year: number;
  priceCents: number;
  currency: string;
  mileageKm: number;
}): Promise<void> {
  try {
    const { matchVehicleAgainstDemands } = await import("./demand-matching-service");
    await matchVehicleAgainstDemands({
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      priceCents: vehicle.priceCents,
      currency: vehicle.currency,
      mileageKm: vehicle.mileageKm,
    });
  } catch (error) {
    console.error("demand_match_failed", {
      vehicleId: vehicle.id,
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export function adminVehicle(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getAdminVehicle(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    const version = requiredInteger(payload, "expectedVersion", { min: 1 });
    if (payload.nextStatus !== undefined || payload.action === "archive") {
      const nextStatus = payload.action === "archive"
        ? "ARCHIVED"
        : requiredString(payload, "nextStatus", { max: 30 });
      const vehicle = await transitionAdminVehicle(dependencies(actor), {
        id: safeId,
        expectedVersion: version,
        nextStatus: nextStatus as VehicleStatus,
      });
      // Publicar una unidad es el momento en que se sabe si alguien la estaba
      // esperando. Las coincidencias quedan guardadas para el panel; no le
      // llega nada a ningún cliente hasta que una persona lo decide.
      if (vehicle.status === "AVAILABLE") await recordDemandMatches(vehicle);
      return adminData(vehicle);
    }
    const patch = payload.patch && typeof payload.patch === "object" && !Array.isArray(payload.patch)
      ? payload.patch as Record<string, unknown>
      : Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "expectedVersion"));
    return adminData(await editAdminVehicle(dependencies(actor), {
      id: safeId,
      expectedVersion: version,
      patch,
    }));
  });
}

export function adminLeads(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => adminData(await listAdminLeads(dependencies(actor), {
    status: statusFilter(request, ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const),
    assignedTo: new URL(request.url).searchParams.get("assignedTo") ?? undefined,
    limit: limitFilter(request),
  })));
}

export function adminLead(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getAdminLead(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    return adminData(await transitionAdminLead(dependencies(actor), {
      id: safeId,
      expectedVersion: requiredInteger(payload, "expectedVersion", { min: 1 }),
      nextStatus: requiredString(payload, "nextStatus", { max: 30 }) as LeadStatus,
      assignedTo: typeof payload.assignedTo === "string" ? payload.assignedTo : undefined,
      lostReason: typeof payload.lostReason === "string" ? payload.lostReason : undefined,
    }));
  });
}

/**
 * Respuesta manual desde el panel. Pasa por el mismo circuito de salida que
 * usa el asesor: hace cumplir la ventana de 24 horas y el ritmo por
 * destinatario, y deja el saliente citado con quién lo mandó.
 */
export function adminConversationReply(
  request: Request,
  id: string,
  runtime: OutboundRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    const text = requiredString(payload, "text", { min: 1, max: 4_000 });
    const { sendOutboundMessage } = await import("./inbox-outbound");
    const result = await sendOutboundMessage(
      {
        conversationId: safeId,
        text,
        author: { type: "SELLER", id: actor.email },
        idempotencyKey,
      },
      runtime,
    );
    return adminData(result);
  });
}

/**
 * Interruptor de modo (asesor / persona) y asignación desde el panel. Escalar
 * exige un motivo — se asienta en la línea de tiempo del lead—; devolver la
 * conversación al asesor se niega si la ventana de 24 horas está cerrada.
 */
export function adminConversationHandling(
  request: Request,
  id: string,
  runtime: OutboundRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    const payload = await readJsonObject(request);
    const handling = requiredString(payload, "handling", { max: 10 });
    const assignTo = typeof payload.assignTo === "string" ? payload.assignTo : undefined;
    const { escalateToHuman, handOverToAdvisor } = await import("./inbox-outbound");
    if (handling === "HUMAN") {
      const reason = requiredString(payload, "reason", { min: 2, max: 200 });
      await escalateToHuman({ conversationId: safeId, reason, assignTo: assignTo ?? actor.email }, runtime);
      return adminData({ handling: "HUMAN" });
    }
    if (handling === "AI") {
      await handOverToAdvisor({ conversationId: safeId }, runtime);
      return adminData({ handling: "AI" });
    }
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", { handling: "invalid_handling" });
  });
}

/**
 * Flujo operativo de la bandeja. Los recordatorios son internos: esta ruta no
 * llama a Zernio ni envía mensajes. La identidad del responsable de
 * "asignarme" sale siempre de la sesión autenticada.
 */
export function adminConversationWorkflow(
  request: Request,
  id: string,
  runtime: { repository?: ChannelInboxRepositoryLike; now?: Date } = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    const payload = await readJsonObject(request);
    const expectedVersion = requiredInteger(payload, "expectedVersion", { min: 1 });
    const action = requiredEnum(payload, "action", [
      "assign-self",
      "schedule-follow-up",
      "clear-follow-up",
      "mark-lost",
    ] as const);
    const now = runtime.now ?? new Date();
    const { D1ChannelInboxRepository } = await import("@/lib/data/channel-inbox-repository");
    const repository = runtime.repository ?? new D1ChannelInboxRepository();

    let workflowAction;
    if (action === "assign-self") {
      workflowAction = { type: "ASSIGN" as const, assignedTo: actor.email };
    } else if (action === "schedule-follow-up") {
      const followUpAt = requiredString(payload, "followUpAt", { max: 40 });
      const due = new Date(followUpAt);
      if (!Number.isFinite(due.getTime()) || due.getTime() <= now.getTime()) {
        throw new ApiError(422, "VALIDATION_ERROR", "El seguimiento debe quedar para una fecha futura.", {
          followUpAt: "future_datetime_required",
        });
      }
      if (due.getTime() > now.getTime() + 366 * 86_400_000) {
        throw new ApiError(422, "VALIDATION_ERROR", "El seguimiento no puede programarse a más de un año.", {
          followUpAt: "too_far",
        });
      }
      workflowAction = {
        type: "SCHEDULE_FOLLOW_UP" as const,
        assignedTo: actor.email,
        followUpAt: due.toISOString(),
        note: optionalString(payload, "note", 500) ?? null,
      };
    } else if (action === "clear-follow-up") {
      workflowAction = { type: "CLEAR_FOLLOW_UP" as const };
    } else {
      workflowAction = {
        type: "MARK_LOST" as const,
        reason: requiredString(payload, "reason", { min: 2, max: 500 }),
      };
    }

    const result = await repository.updateConversationWorkflow({
      conversationId: safeId,
      expectedVersion,
      action: workflowAction,
      actor: { userId: actor.userId, email: actor.email },
      updatedAt: now.toISOString(),
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "La conversación no existe.");
      }
      if (result.reason === "conflict") {
        throw new ApiError(409, "ADMIN_VERSION_CONFLICT", "La conversación cambió. Recargá antes de continuar.");
      }
      if (result.reason === "closed") {
        throw new ApiError(409, "CONVERSATION_CLOSED", "La conversación ya está cerrada.");
      }
      if (result.reason === "lead_required") {
        throw new ApiError(409, "LEAD_REQUIRED", "La conversación todavía no tiene un lead para marcar como perdido.");
      }
      throw new ApiError(409, "LEAD_ALREADY_WON", "Una oportunidad ganada no puede marcarse como perdida.");
    }
    return adminData({ action, nextVersion: result.nextVersion });
  });
}

/**
 * Alta y listado de cuentas del canal (WhatsApp, Instagram, Messenger,
 * Telegram, SMS). Sin al menos una cuenta ACTIVE, el webhook no tiene a
 * quién enrutar un mensaje entrante y lo archiva como no enrutado.
 */
export function adminChannelAccounts(
  request: Request,
  runtime: { repository?: ChannelInboxRepositoryLike; now?: Date } = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const { D1ChannelInboxRepository } = await import("@/lib/data/channel-inbox-repository");
    const repository = runtime.repository ?? new D1ChannelInboxRepository();
    if (request.method === "GET") {
      return adminData(await repository.listChannelAccounts());
    }
    requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    const platform = requiredEnum(payload, "platform", [
      "whatsapp",
      "instagram",
      "messenger",
      "telegram",
      "sms",
    ] as const);
    const now = runtime.now ?? new Date();
    const result = await repository.createChannelAccount({
      id: crypto.randomUUID(),
      provider: "ZERNIO",
      platform,
      externalAccountId: requiredString(payload, "externalAccountId", { min: 1, max: 120 }),
      displayName: requiredString(payload, "displayName", { min: 2, max: 120 }),
      status: optionalEnum(payload, "status", ["ACTIVE", "PAUSED"] as const) ?? "ACTIVE",
      defaultAssignee: optionalString(payload, "defaultAssignee", 120) ?? actor.email,
      updatedAt: now.toISOString(),
    });
    return adminData(result, { status: 201 });
  });
}

export function adminAppraisals(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => adminData(await listAdminAppraisals(dependencies(actor), {
    status: statusFilter(request, ["SUBMITTED", "IN_REVIEW", "ESTIMATED", "APPROVED", "REJECTED", "EXPIRED"] as const),
    limit: limitFilter(request),
  })));
}

export function adminAppraisal(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getAdminAppraisal(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    return adminData(await reviewAdminAppraisal(dependencies(actor), {
      ...payload,
      id: safeId,
      expectedVersion: requiredInteger(payload, "expectedVersion", { min: 1 }),
      nextStatus: requiredString(payload, "nextStatus", { max: 30 }) as AppraisalStatus,
      currency: payload.currency ?? "ARS",
    }));
  });
}

export function adminConsignments(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => adminData(await listAdminConsignments(dependencies(actor), {
    status: statusFilter(request, ["SUBMITTED", "IN_REVIEW", "ACCEPTED", "REJECTED"] as const),
    limit: limitFilter(request),
  })));
}

export function adminConsignment(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getAdminConsignment(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    return adminData(await reviewAdminConsignment(dependencies(actor), {
      id: safeId,
      expectedVersion: requiredInteger(payload, "expectedVersion", { min: 1 }),
      nextStatus: requiredString(payload, "nextStatus", { max: 30 }) as ConsignmentStatus,
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
    }));
  });
}

export function adminFinancePlans(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    if (request.method === "GET") return adminData(await listFinanceVersions(dependencies(actor)));
    const payload = await readJsonObject(request);
    const input = {
      ...payload,
      idempotencyKey: requireIdempotencyKey(request),
      currency: payload.currency ?? "ARS",
    } as unknown as CreateFinanceVersionInput;
    return adminData(await createFinanceVersion(dependencies(actor), input), { status: 201 });
  });
}

export function adminFinancePlan(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getFinanceVersion(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    const action = requiredString(payload, "action", { max: 20 });
    if (action !== "publish" && action !== "retire") {
      throw new ApiError(422, "VALIDATION_ERROR", "La acción financiera no es válida.");
    }
    return adminData(await transitionFinanceVersion(dependencies(actor), {
      id: safeId,
      expectedVersion: requiredInteger(payload, "expectedVersion", { min: 1 }),
      nextStatus: action === "publish" ? "PUBLISHED" : "RETIRED",
    }));
  });
}

export function adminPromotions(request: Request): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    if (request.method === "GET") return adminData(await listAdminPromotions(dependencies(actor), {
      status: statusFilter(request, ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"] as const),
      limit: limitFilter(request),
    }));
    const payload = await readJsonObject(request);
    const input = {
      ...payload,
      idempotencyKey: requireIdempotencyKey(request),
      normalConditionsSnapshot: payload.normalConditionsSnapshot ?? {
        demo: payload.isDemo === true,
        disclaimer: payload.isDemo === true
          ? "DEMO: condición ficticia para previsualización; no constituye una oferta comercial real."
          : undefined,
      },
    } as unknown as CreatePromotionInput;
    return adminData(await createAdminPromotion(dependencies(actor), input), { status: 201 });
  });
}

export function adminPromotion(request: Request, id: string): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const safeId = resourceId(id);
    if (request.method === "GET") return adminData(await getAdminPromotion(dependencies(actor), safeId));
    const payload = await readJsonObject(request);
    const expectedVersion = requiredInteger(payload, "expectedVersion", { min: 1 });
    const action = requiredString(payload, "action", { max: 20 });
    if (action === "schedule") {
      return adminData(await scheduleAdminPromotion(dependencies(actor), {
        id: safeId, expectedVersion,
        startsAt: requiredString(payload, "startsAt", { max: 40 }),
        endsAt: requiredString(payload, "endsAt", { max: 40 }),
      }));
    }
    if (action === "activate") {
      return adminData(await activateAdminPromotion(dependencies(actor), { id: safeId, expectedVersion }));
    }
    if (action === "pause") {
      return adminData(await pauseAdminPromotion(dependencies(actor), { id: safeId, expectedVersion }));
    }
    if (action === "expire") {
      return adminData(await expireAdminPromotion(dependencies(actor), { id: safeId, expectedVersion }));
    }
    if (action === "archive") {
      return adminData(await archiveAdminPromotion(dependencies(actor), { id: safeId, expectedVersion }));
    }
    throw new ApiError(422, "VALIDATION_ERROR", "La acción de oferta no es válida.");
  });
}
