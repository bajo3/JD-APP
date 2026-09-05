import {
  D1ConsignmentMediaRepository,
  CONSIGNMENT_CAPTURE_TYPES,
  type ConsignmentCaptureType,
  type ConsignmentMediaRecord,
} from "@/lib/data/consignment-media-repository";
import { objectStore, type ObjectStore } from "@/lib/data/storage";
import {
  digestImageSha256,
  inspectAppraisalImage,
  MAX_MEDIA_IMAGE_BYTES,
  MediaPolicyError,
  stripImageMetadata,
} from "@/lib/media/index.mjs";
import { adminApiRoute, adminData } from "./admin-api";
import type { AdminAuthOptions } from "./admin-auth";
import {
  ApiError,
  apiRoute,
  json,
  requireIdempotencyKey,
} from "./api";

type MediaRepository = D1ConsignmentMediaRepository;

export type ConsignmentMediaRuntime = Readonly<{
  auth?: AdminAuthOptions;
  repository?: MediaRepository;
  objects?: ObjectStore;
  now?: Date;
  idGenerator?: () => string;
  staleMinutes?: number;
}>;

const CONSIGNMENT_CODE_PATTERN = /^CON-[0-9A-F]{6}$/;
const DEFAULT_STALE_MINUTES = 60;

function consignmentCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CONSIGNMENT_CODE_PATTERN.test(normalized)) {
    throw new ApiError(404, "CONSIGNMENT_NOT_FOUND", "No encontramos la oferta de consignación.");
  }
  return normalized;
}

function resourceId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) {
    throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "El recurso no existe.");
  }
  return value;
}

function captureType(request: Request): ConsignmentCaptureType {
  const value = request.headers.get("X-Capture-Type")?.trim().toUpperCase() ?? "";
  if (!(CONSIGNMENT_CAPTURE_TYPES as readonly string[]).includes(value)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      captureType: "El tipo de foto no es válido.",
    });
  }
  return value as ConsignmentCaptureType;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * El código público CON-XXXXXX identifica la oferta; no autoriza nada. La
 * carga exige el bearer entregado en el alta. Código inexistente, token
 * incorrecto o faltante y registro legacy responden igual y fallan cerrados.
 */
async function bearerTokenHash(request: Request): Promise<string | null> {
  const header = request.headers.get("Authorization")?.trim() ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.length < 32 || token.length > 128 || !/^[A-Za-z0-9._-]+$/.test(token)) return null;
  return sha256Hex(token);
}

async function readLimitedBinary(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ApiError(400, "INVALID_CONTENT_LENGTH", "El tamaño declarado no es válido.");
    }
    if (length > MAX_MEDIA_IMAGE_BYTES) {
      throw new ApiError(413, "CONSIGNMENT_IMAGE_TOO_LARGE", "La foto supera el máximo de 4 MiB.");
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
      if (total > MAX_MEDIA_IMAGE_BYTES) {
        try {
          await reader.cancel("consignment_image_too_large");
        } catch {
          // The stable API error takes precedence over transport cleanup.
        }
        throw new ApiError(413, "CONSIGNMENT_IMAGE_TOO_LARGE", "La foto supera el máximo de 4 MiB.");
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

function policyError(error: MediaPolicyError): never {
  const status = error.code === "STOCK_IMAGE_TOO_LARGE"
    ? 413
    : error.code === "STOCK_IMAGE_UNSUPPORTED_CONTENT_TYPE" ||
        error.code === "STOCK_IMAGE_CONTENT_TYPE_MISMATCH"
      ? 415
      : 422;
  const code = `CONSIGNMENT_IMAGE_${error.code.replace("STOCK_IMAGE_", "")}`;
  throw new ApiError(status, code, error.message);
}

async function requestHash(input: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(input);
  return digestImageSha256(new TextEncoder().encode(canonical));
}

function publicMediaDto(media: ConsignmentMediaRecord) {
  return {
    id: media.id,
    captureType: media.captureType,
    contentType: media.contentType,
    byteSize: media.byteSize,
    sha256: media.sha256,
    uploadedAt: media.uploadedAt,
  };
}

function adminMediaDto(media: ConsignmentMediaRecord) {
  return {
    id: media.id,
    captureType: media.captureType,
    contentType: media.contentType,
    byteSize: media.byteSize,
    sha256: media.sha256,
    sortOrder: media.sortOrder,
    uploadedAt: media.uploadedAt,
    url: `/api/v1/admin/consignments/${media.consignmentId}/photos/${media.id}`,
  };
}

function staleCutoff(now: Date, staleMinutes?: number): string {
  const minutes = staleMinutes ?? staleMinutesFromEnv();
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function staleMinutesFromEnv(): number {
  const raw = Number(process.env.CONSIGNMENT_MEDIA_STALE_MINUTES);
  return Number.isSafeInteger(raw) && raw >= 1 && raw <= 10_080 ? raw : DEFAULT_STALE_MINUTES;
}

/**
 * Reanuda o compensa una reserva caída entre D1 y R2: vuelve a escribir el
 * objeto privado y confirma el paso a READY. Nunca afirma éxito sin la
 * confirmación en base.
 */
async function driveStorageToReady(input: {
  record: ConsignmentMediaRecord;
  bytes: Uint8Array;
  contentType: string;
  repository: MediaRepository;
  objects: ObjectStore;
  occurredAt: string;
}): Promise<Response> {
  try {
    await input.objects.putPrivateConsignmentImage({
      consignmentId: input.record.consignmentId,
      mediaId: input.record.id,
      body: input.bytes,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      sha256: input.record.sha256,
    });
  } catch {
    try {
      await input.repository.markFailed(input.record.id, input.occurredAt);
    } catch (error) {
      console.error("consignment_media_mark_failed_failed", { mediaId: input.record.id, error });
    }
    throw new ApiError(503, "MEDIA_STORAGE_UNAVAILABLE", "No pudimos guardar la foto.");
  }
  const confirmed = await input.repository.confirmReady(
    input.record.id,
    input.record.version,
    input.occurredAt,
  );
  if (!confirmed) {
    throw new ApiError(503, "MEDIA_STORAGE_UNAVAILABLE", "No pudimos guardar la foto.");
  }
  const fresh = await input.repository.findByMediaId(
    input.record.consignmentId,
    input.record.id,
  );
  return json({ data: publicMediaDto(fresh ?? input.record) }, { status: 201 });
}

export function publicConsignmentPhotoUpload(
  request: Request,
  codeValue: string,
  runtime: ConsignmentMediaRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const code = consignmentCode(codeValue);
    const idempotencyKey = requireIdempotencyKey(request);
    const type = captureType(request);
    const tokenHash = await bearerTokenHash(request);

    const repository = runtime.repository ?? new D1ConsignmentMediaRepository();
    const consignment = await repository.findConsignmentByPublicCode(code);
    if (
      !consignment ||
      !consignment.uploadTokenHash ||
      consignment.uploadTokenHash !== tokenHash
    ) {
      throw new ApiError(404, "CONSIGNMENT_NOT_FOUND", "No encontramos la oferta de consignación.");
    }
    if (consignment.status !== "SUBMITTED") {
      throw new ApiError(
        409,
        "CONSIGNMENT_UPLOAD_CLOSED",
        "La consignación ya está en revisión y no admite más fotos.",
      );
    }

    const bytes = await readLimitedBinary(request);

    let inspection;
    try {
      inspection = await inspectAppraisalImage({
        bytes,
        declaredContentType: request.headers.get("Content-Type"),
      });
    } catch (error) {
      if (error instanceof MediaPolicyError) policyError(error);
      throw error;
    }

    const stripped = stripImageMetadata(bytes, inspection.contentType);
    const sha256 = await digestImageSha256(stripped.bytes);
    const hash = await requestHash({
      consignmentCode: code,
      captureType: type,
      contentType: inspection.contentType,
      byteSize: stripped.bytes.byteLength,
      sha256,
    });

    const earlyReplay = await repository.findUploadReplay(idempotencyKey, hash);
    if (earlyReplay === "conflict") {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra foto.");
    }
    if (earlyReplay) {
      if (earlyReplay.status === "READY") {
        return json({ data: publicMediaDto(earlyReplay), meta: { idempotencyReplayed: true } }, {
          status: 200,
          headers: { "Idempotency-Replayed": "true" },
        });
      }
      return driveStorageToReady({
        record: earlyReplay,
        bytes: stripped.bytes,
        contentType: inspection.contentType,
        repository,
        objects: runtime.objects ?? objectStore,
        occurredAt: (runtime.now ?? new Date()).toISOString(),
      });
    }

    const occurredAt = (runtime.now ?? new Date()).toISOString();
    const objects = runtime.objects ?? objectStore;

    // Reservas abandonadas liberan su espacio y su objeto huérfano antes de
    // ocupar un slot nuevo.
    const stale = await repository.archiveStale(
      consignment.id,
      staleCutoff(new Date(occurredAt), runtime.staleMinutes),
      occurredAt,
    );
    for (const row of stale) {
      try {
        await objects.deleteObject(row.r2Key);
      } catch {
        console.error("consignment_media_orphan_cleanup_failed", { mediaId: row.id });
      }
    }

    const mediaId = runtime.idGenerator?.() ?? crypto.randomUUID();
    const r2Key = `private/consignments/${consignment.id}/${mediaId}`;
    const inserted = await repository.insertUpload(
      {
        mediaId,
        consignmentId: consignment.id,
        r2Key,
        contentType: inspection.contentType,
        byteSize: stripped.bytes.byteLength,
        sha256,
        captureType: type,
      },
      { idempotencyKey, requestHash: hash, occurredAt },
    );
    if (!inserted.ok) {
      if (inserted.reason === "consignment_not_found") {
        throw new ApiError(404, "CONSIGNMENT_NOT_FOUND", "No encontramos la oferta de consignación.");
      }
      if (inserted.reason === "consignment_closed") {
        throw new ApiError(
          409,
          "CONSIGNMENT_UPLOAD_CLOSED",
          "La consignación ya está en revisión y no admite más fotos.",
        );
      }
      if (inserted.reason === "capture_occupied") {
        throw new ApiError(
          409,
          "CONSIGNMENT_CAPTURE_OCCUPIED",
          "Ese espacio de fotos ya tiene una imagen para esta consignación.",
        );
      }
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra foto.");
    }
    if (inserted.replayed && inserted.record.status === "READY") {
      return json({ data: publicMediaDto(inserted.record), meta: { idempotencyReplayed: true } }, {
        status: 200,
        headers: { "Idempotency-Replayed": "true" },
      });
    }
    return driveStorageToReady({
      record: inserted.record,
      bytes: stripped.bytes,
      contentType: inspection.contentType,
      repository,
      objects,
      occurredAt,
    });
  });
}

export function adminConsignmentPhotoList(
  request: Request,
  idValue: string,
  runtime: ConsignmentMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async () => {
    if (request.method !== "GET") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const consignmentId = resourceId(idValue);
    const repository = runtime.repository ?? new D1ConsignmentMediaRepository();
    const consignment = await repository.findConsignmentById(consignmentId);
    if (!consignment) {
      throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "La consignación no existe.");
    }
    return adminData((await repository.listReadyByConsignment(consignmentId)).map(adminMediaDto));
  }, runtime.auth);
}

export function adminConsignmentPhotoBytes(
  request: Request,
  idValue: string,
  mediaIdValue: string,
  runtime: ConsignmentMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async () => {
    if (request.method !== "GET") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const consignmentId = resourceId(idValue);
    const mediaId = resourceId(mediaIdValue);
    const repository = runtime.repository ?? new D1ConsignmentMediaRepository();
    const media = await repository.findReadyByMediaId(consignmentId, mediaId);
    if (!media) {
      throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "La foto no existe.");
    }
    if (media.byteSize > MAX_MEDIA_IMAGE_BYTES) {
      throw new ApiError(413, "CONSIGNMENT_IMAGE_TOO_LARGE", "La foto supera el máximo de 4 MiB.");
    }
    const object = await (runtime.objects ?? objectStore).getPrivateObject(media.r2Key);
    if (!object) {
      throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "La foto no existe.");
    }
    return new Response(object.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Type": media.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: `"${media.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }, runtime.auth);
}
