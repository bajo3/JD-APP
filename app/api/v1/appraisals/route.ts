import {
  ApiError,
  apiRoute,
  json,
  optionalBoolean,
  optionalString,
  publicCode,
  readJsonObject,
  requireIdempotencyKey,
  requiredInteger,
  requiredString,
} from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { appraisalDto } from "@/lib/server/dto";

export async function POST(request: Request): Promise<Response> {
  return apiRoute(async () => {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = await readJsonObject(request);
    const vehicleValue = payload.vehicle;
    if (!vehicleValue || typeof vehicleValue !== "object" || Array.isArray(vehicleValue)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        vehicle: "Completá los datos del vehículo.",
      });
    }
    const vehicle = vehicleValue as Record<string, unknown>;
    const declaredCondition = requiredString(vehicle, "declaredCondition", { min: 2, max: 40 }).toUpperCase();
    if (!new Set(["EXCELLENT", "GOOD", "FAIR", "NEEDS_REPAIR"]).has(declaredCondition)) {
      throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
        declaredCondition: "El estado declarado no es válido.",
      });
    }
    const leadId = optionalString(payload, "leadId", 80);
    const access = getDataAccess();
    if (leadId && !(await access.leads.findById(leadId))) {
      throw new ApiError(404, "LEAD_NOT_FOUND", "No encontramos el contacto asociado.");
    }

    const id = crypto.randomUUID();
    const appraisal = await access.appraisals.create({
      id,
      publicCode: publicCode("TAS"),
      idempotencyKey,
      leadId,
      make: requiredString(vehicle, "make", { min: 2, max: 60 }),
      model: requiredString(vehicle, "model", { min: 1, max: 80 }),
      trim: optionalString(vehicle, "trim", 80),
      year: requiredInteger(vehicle, "year", { min: 1950, max: new Date().getFullYear() + 1 }),
      mileageKm: requiredInteger(vehicle, "mileageKm", { min: 0, max: 3_000_000 }),
      declaredCondition,
      documentationStatus: optionalString(vehicle, "documentationStatus", 60),
      hasLien: optionalBoolean(vehicle, "hasLien") ?? false,
      repairNotes: optionalString(vehicle, "repairNotes", 2_000),
      status: "SUBMITTED",
      certaintyLevel: "T0",
    });
    const replayed = appraisal.id !== id;
    return json(
      {
        data: appraisalDto(appraisal),
        meta: { ...sourceMeta(access.source), idempotencyReplayed: replayed },
      },
      {
        status: replayed ? 200 : 201,
        headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
      },
    );
  });
}
