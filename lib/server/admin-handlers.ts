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
import { adminApiRoute, adminData } from "./admin-api";
import type { AdminApiActor } from "./admin-auth";
import {
  ApiError,
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
      return adminData(await transitionAdminVehicle(dependencies(actor), {
        id: safeId,
        expectedVersion: version,
        nextStatus: nextStatus as VehicleStatus,
      }));
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
