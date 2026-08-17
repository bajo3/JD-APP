import {
  D1VehicleMediaRepository,
  type MediaMutationResult,
  type VehicleMediaRecord,
} from "@/lib/data/vehicle-media-repository";
import { objectStore, type ObjectStore } from "@/lib/data/storage";
import {
  inspectStockImage,
  MAX_STOCK_IMAGE_BYTES,
  MediaPolicyError,
} from "@/lib/media/index.mjs";
import { adminApiRoute, adminData, hashAdminPayload } from "./admin-api";
import type { AdminApiActor } from "./admin-auth";
import {
  ApiError,
  apiRoute,
  readJsonObject,
  requireIdempotencyKey,
  requiredString,
} from "./api";

type MediaRepository = D1VehicleMediaRepository;

export type VehicleMediaRuntime = Readonly<{
  repository?: MediaRepository;
  objects?: ObjectStore;
  now?: Date;
  idGenerator?: () => string;
}>;

function resourceId(value: string, field: string): string {
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) {
    throw new ApiError(400, "INVALID_MEDIA_RESOURCE_ID", "El identificador no es válido.", {
      [field]: "Formato inválido.",
    });
  }
  return value;
}

function vehicleVersion(request: Request): number {
  const raw = request.headers.get("X-Vehicle-Version")?.trim() ?? "";
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new ApiError(
      400,
      "VEHICLE_VERSION_REQUIRED",
      "Se requiere un encabezado X-Vehicle-Version válido.",
    );
  }
  return version;
}

function altText(request: Request): string {
  const value = request.headers.get("X-Alt-Text")?.trim() ?? "";
  if (value.length < 3 || value.length > 240) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      altText: "Debe tener entre 3 y 240 caracteres.",
    });
  }
  return value;
}

async function readLimitedBinary(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ApiError(400, "INVALID_CONTENT_LENGTH", "El tamaño declarado no es válido.");
    }
    if (length > MAX_STOCK_IMAGE_BYTES) {
      throw new ApiError(413, "STOCK_IMAGE_TOO_LARGE", "La imagen supera el máximo de 5 MiB.");
    }
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_STOCK_IMAGE_BYTES) {
        try {
          await reader.cancel("stock_image_too_large");
        } catch {
          // The stable API error takes precedence over transport cleanup.
        }
        throw new ApiError(413, "STOCK_IMAGE_TOO_LARGE", "La imagen supera el máximo de 5 MiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mediaPolicyError(error: MediaPolicyError): never {
  const status = error.code === "STOCK_IMAGE_TOO_LARGE"
    ? 413
    : error.code === "STOCK_IMAGE_UNSUPPORTED_CONTENT_TYPE"
      ? 415
      : 422;
  throw new ApiError(status, error.code, error.message);
}

function mediaDto(media: VehicleMediaRecord) {
  return {
    id: media.id,
    vehicleId: media.vehicleId,
    url: media.publicUrl,
    contentType: media.contentType,
    altText: media.altText,
    byteSize: media.byteSize,
    sha256: media.sha256,
    status: media.status,
    sortOrder: media.sortOrder,
    version: media.version,
    uploadedBy: media.uploadedBy,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    archivedAt: media.archivedAt,
  };
}

function mutationError<T>(result: MediaMutationResult<T>): never {
  if (result.ok) throw new Error("MEDIA_MUTATION_RESULT_INVALID");
  if (result.reason === "not_found") {
    throw new ApiError(404, "MEDIA_NOT_FOUND", "La foto o el vehículo no existen.");
  }
  if (result.reason === "duplicate") {
    throw new ApiError(
      409,
      "MEDIA_DUPLICATE",
      "La misma foto o clave de idempotencia ya fue registrada.",
    );
  }
  throw new ApiError(
    409,
    "ADMIN_VERSION_CONFLICT",
    "El vehículo cambió desde la última lectura.",
    result.currentVersion ? { currentVersion: String(result.currentVersion) } : undefined,
  );
}

function adminMediaData(data: unknown, version: number, status = 200): Response {
  return adminData(data, {
    status,
    headers: { "X-Vehicle-Version": String(version) },
  });
}

export function adminVehicleMediaCollection(
  request: Request,
  vehicleIdValue: string,
  runtime: VehicleMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    const vehicleId = resourceId(vehicleIdValue, "vehicleId");
    const repository = runtime.repository ?? new D1VehicleMediaRepository();
    if (request.method === "GET") {
      const version = await repository.findVehicleVersion(vehicleId);
      if (version === null) {
        throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "El vehículo no existe.");
      }
      return adminMediaData(
        (await repository.listAdmin(vehicleId)).map(mediaDto),
        version,
      );
    }
    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    return uploadVehicleMedia(request, vehicleId, actor, repository, runtime);
  });
}

async function uploadVehicleMedia(
  request: Request,
  vehicleId: string,
  actor: AdminApiActor,
  repository: MediaRepository,
  runtime: VehicleMediaRuntime,
): Promise<Response> {
  const idempotencyKey = requireIdempotencyKey(request);
  const expectedVehicleVersion = vehicleVersion(request);
  const alternativeText = altText(request);
  const bytes = await readLimitedBinary(request);
  let inspection;
  try {
    inspection = await inspectStockImage({
      bytes,
      declaredContentType: request.headers.get("Content-Type"),
    });
  } catch (error) {
    if (error instanceof MediaPolicyError) mediaPolicyError(error);
    throw error;
  }
  if (!inspection.sha256) {
    throw new ApiError(500, "STOCK_IMAGE_HASH_UNAVAILABLE", "No pudimos verificar la foto.");
  }
  const requestHash = await hashAdminPayload({
    vehicleId,
    alternativeText,
    contentType: inspection.contentType,
    byteSize: inspection.byteSize,
    sha256: inspection.sha256,
  });
  const earlyReplay = await repository.findUploadReplay(idempotencyKey, requestHash);
  if (earlyReplay === "conflict") {
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra foto.");
  }
  if (earlyReplay?.status === "READY") {
    const currentVersion = await repository.findVehicleVersion(vehicleId);
    return adminMediaData(mediaDto(earlyReplay), currentVersion ?? expectedVehicleVersion, 200);
  }

  const mediaId = earlyReplay?.id ?? runtime.idGenerator?.() ?? crypto.randomUUID();
  const r2Key = `public/stock/${vehicleId}/${mediaId}`;
  const now = (runtime.now ?? new Date()).toISOString();
  const reservation = await repository.reserveUpload(
    {
      mediaId,
      vehicleId,
      r2Key,
      publicUrl: `/api/v1/media/vehicles/${mediaId}`,
      contentType: inspection.contentType,
      altText: alternativeText,
      byteSize: inspection.byteSize,
      sha256: inspection.sha256,
    },
    {
      idempotencyKey,
      requestHash,
      expectedVehicleVersion,
      actor,
      occurredAt: now,
    },
  );
  if (!reservation.ok) mutationError(reservation);
  if (reservation.record.status === "READY") {
    return adminMediaData(mediaDto(reservation.record), reservation.vehicleVersion, 200);
  }

  const objects = runtime.objects ?? objectStore;
  try {
    await objects.putStockImage({
      vehicleId,
      mediaId: reservation.record.id,
      body: bytes,
      contentType: inspection.contentType,
      byteSize: inspection.byteSize,
      sha256: inspection.sha256,
    });
  } catch {
    await repository.markFailed(reservation.record.id, actor, now);
    throw new ApiError(503, "MEDIA_STORAGE_UNAVAILABLE", "No pudimos guardar la foto.");
  }

  let ready: VehicleMediaRecord;
  try {
    ready = await repository.markReady(reservation.record.id, actor, now);
  } catch {
    try {
      await objects.deleteObject(r2Key);
    } catch {
      console.error("vehicle_media_compensation_failed", { mediaId: reservation.record.id });
    }
    try {
      await repository.markFailed(reservation.record.id, actor, now);
    } catch {
      console.error("vehicle_media_failed_state_unavailable", { mediaId: reservation.record.id });
    }
    throw new ApiError(503, "MEDIA_METADATA_UNAVAILABLE", "No pudimos confirmar la foto.");
  }
  return adminMediaData(
    mediaDto(ready),
    reservation.vehicleVersion,
    reservation.replayed ? 200 : 201,
  );
}

export function adminVehicleMediaItem(
  request: Request,
  vehicleIdValue: string,
  mediaIdValue: string,
  runtime: VehicleMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async (actor) => {
    if (request.method !== "PATCH") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const vehicleId = resourceId(vehicleIdValue, "vehicleId");
    const mediaId = resourceId(mediaIdValue, "mediaId");
    const expectedVehicleVersion = vehicleVersion(request);
    const payload = await readJsonObject(request);
    const action = requiredString(payload, "action", { min: 3, max: 30 });
    const repository = runtime.repository ?? new D1VehicleMediaRepository();
    const now = (runtime.now ?? new Date()).toISOString();
    if (action === "archive") {
      const result = await repository.archive(
        vehicleId,
        mediaId,
        expectedVehicleVersion,
        actor,
        now,
      );
      if (!result.ok) mutationError(result);
      return adminMediaData(mediaDto(result.record), result.vehicleVersion);
    }

    let orderedIds: string[];
    if (action === "set_primary") {
      const ready = (await repository.listAdmin(vehicleId)).filter(
        (item) => item.status === "READY",
      );
      if (!ready.some((item) => item.id === mediaId)) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "La foto no está disponible.");
      }
      orderedIds = [mediaId, ...ready.filter((item) => item.id !== mediaId).map((item) => item.id)];
    } else if (action === "reorder") {
      const raw = payload.orderedMediaIds;
      if (
        !Array.isArray(raw) || raw.length === 0 || raw.length > 100 ||
        raw.some((id) => typeof id !== "string" || !/^[A-Za-z0-9._:-]{3,200}$/.test(id))
      ) {
        throw new ApiError(422, "VALIDATION_ERROR", "El orden de fotos no es válido.");
      }
      orderedIds = raw as string[];
    } else {
      throw new ApiError(422, "INVALID_MEDIA_ACTION", "La acción de foto no está permitida.");
    }
    const result = await repository.reorder(
      vehicleId,
      orderedIds,
      expectedVehicleVersion,
      actor,
      now,
    );
    if (!result.ok) mutationError(result);
    return adminMediaData(result.record.map(mediaDto), result.vehicleVersion);
  });
}

export function publicVehicleMedia(
  request: Request,
  mediaIdValue: string,
  runtime: VehicleMediaRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const mediaId = resourceId(mediaIdValue, "mediaId");
    const repository = runtime.repository ?? new D1VehicleMediaRepository();
    const media = await repository.findPublic(mediaId);
    if (!media) throw new ApiError(404, "MEDIA_NOT_FOUND", "La foto no está disponible.");
    const etag = `"${media.sha256}"`;
    const headers = new Headers({
      "Cache-Control": "public, max-age=300, must-revalidate",
      "Content-Disposition": "inline",
      "Content-Type": media.contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    const object = await (runtime.objects ?? objectStore).getStockObject(media.r2Key);
    if (!object) throw new ApiError(404, "MEDIA_NOT_FOUND", "La foto no está disponible.");
    return new Response(object.body, { status: 200, headers });
  });
}
