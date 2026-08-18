import {
  D1AppraisalMediaRepository,
  APPRAISAL_CAPTURE_TYPES,
  type AppraisalCaptureType,
  type AppraisalMediaRecord,
} from "@/lib/data/appraisal-media-repository";
import { objectStore, type ObjectStore } from "@/lib/data/storage";
import {
  digestImageSha256,
  inspectAppraisalImage,
  MAX_APPRAISAL_IMAGE_BYTES,
  MediaPolicyError,
  stripImageMetadata,
} from "@/lib/media/index.mjs";
import { adminApiRoute, adminData } from "./admin-api";
import {
  ApiError,
  apiRoute,
  json,
  requireIdempotencyKey,
} from "./api";

type MediaRepository = D1AppraisalMediaRepository;

export type AppraisalMediaRuntime = Readonly<{
  repository?: MediaRepository;
  objects?: ObjectStore;
  now?: Date;
  idGenerator?: () => string;
}>;

const APPRAISAL_CODE_PATTERN = /^TAS-[0-9A-F]{6}$/;

function appraisalCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!APPRAISAL_CODE_PATTERN.test(normalized)) {
    throw new ApiError(404, "APPRAISAL_NOT_FOUND", "No encontramos la solicitud de tasación.");
  }
  return normalized;
}

function resourceId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) {
    throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "El recurso no existe.");
  }
  return value;
}

function captureType(request: Request): AppraisalCaptureType {
  const value = request.headers.get("X-Capture-Type")?.trim().toUpperCase() ?? "";
  if (!(APPRAISAL_CAPTURE_TYPES as readonly string[]).includes(value)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Hay datos inválidos.", {
      captureType: "El tipo de foto no es válido.",
    });
  }
  return value as AppraisalCaptureType;
}

async function readLimitedBinary(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ApiError(400, "INVALID_CONTENT_LENGTH", "El tamaño declarado no es válido.");
    }
    if (length > MAX_APPRAISAL_IMAGE_BYTES) {
      throw new ApiError(413, "APPRAISAL_IMAGE_TOO_LARGE", "La foto supera el máximo de 10 MiB.");
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
      if (total > MAX_APPRAISAL_IMAGE_BYTES) {
        try {
          await reader.cancel("appraisal_image_too_large");
        } catch {
          // The stable API error takes precedence over transport cleanup.
        }
        throw new ApiError(413, "APPRAISAL_IMAGE_TOO_LARGE", "La foto supera el máximo de 10 MiB.");
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
  const code = `APPRAISAL_IMAGE_${error.code.replace("STOCK_IMAGE_", "")}`;
  throw new ApiError(status, code, error.message);
}

async function requestHash(input: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(input);
  return digestImageSha256(new TextEncoder().encode(canonical));
}

function publicMediaDto(media: AppraisalMediaRecord) {
  return {
    id: media.id,
    captureType: media.captureType,
    contentType: media.contentType,
    byteSize: media.byteSize,
    sha256: media.sha256,
    uploadedAt: media.uploadedAt,
  };
}

function adminMediaDto(media: AppraisalMediaRecord) {
  return {
    id: media.id,
    captureType: media.captureType,
    contentType: media.contentType,
    byteSize: media.byteSize,
    sha256: media.sha256,
    sortOrder: media.sortOrder,
    uploadedAt: media.uploadedAt,
    url: `/api/v1/admin/appraisals/${media.appraisalId}/photos/${media.id}`,
  };
}

export function publicAppraisalPhotoUpload(
  request: Request,
  codeValue: string,
  runtime: AppraisalMediaRuntime = {},
): Promise<Response> {
  return apiRoute(async () => {
    const code = appraisalCode(codeValue);
    const idempotencyKey = requireIdempotencyKey(request);
    const type = captureType(request);
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
      appraisalCode: code,
      captureType: type,
      contentType: inspection.contentType,
      byteSize: stripped.bytes.byteLength,
      sha256,
    });

    const repository = runtime.repository ?? new D1AppraisalMediaRepository();
    const earlyReplay = await repository.findUploadReplay(idempotencyKey, hash);
    if (earlyReplay === "conflict") {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra foto.");
    }
    if (earlyReplay) {
      return json({ data: publicMediaDto(earlyReplay), meta: { idempotencyReplayed: true } }, {
        status: 200,
        headers: { "Idempotency-Replayed": "true" },
      });
    }

    const appraisal = await repository.findAppraisalByPublicCode(code);
    if (!appraisal) {
      throw new ApiError(404, "APPRAISAL_NOT_FOUND", "No encontramos la solicitud de tasación.");
    }
    if (appraisal.status !== "SUBMITTED") {
      throw new ApiError(
        409,
        "APPRAISAL_UPLOAD_CLOSED",
        "La tasación ya está en revisión y no admite más fotos.",
      );
    }

    const mediaId = runtime.idGenerator?.() ?? crypto.randomUUID();
    const r2Key = `private/appraisals/${appraisal.id}/${mediaId}`;
    const occurredAt = (runtime.now ?? new Date()).toISOString();
    const inserted = await repository.insertUpload(
      {
        mediaId,
        appraisalId: appraisal.id,
        r2Key,
        contentType: inspection.contentType,
        byteSize: stripped.bytes.byteLength,
        sha256,
        captureType: type,
      },
      { idempotencyKey, requestHash: hash, occurredAt },
    );
    if (!inserted.ok) {
      if (inserted.reason === "appraisal_not_found") {
        throw new ApiError(404, "APPRAISAL_NOT_FOUND", "No encontramos la solicitud de tasación.");
      }
      if (inserted.reason === "appraisal_closed") {
        throw new ApiError(
          409,
          "APPRAISAL_UPLOAD_CLOSED",
          "La tasación ya está en revisión y no admite más fotos.",
        );
      }
      if (inserted.reason === "capture_occupied") {
        throw new ApiError(
          409,
          "APPRAISAL_CAPTURE_OCCUPIED",
          "Ese espacio de fotos ya tiene una imagen para esta tasación.",
        );
      }
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "La clave ya fue usada con otra foto.");
    }
    if (inserted.replayed) {
      return json({ data: publicMediaDto(inserted.record), meta: { idempotencyReplayed: true } }, {
        status: 200,
        headers: { "Idempotency-Replayed": "true" },
      });
    }

    const objects = runtime.objects ?? objectStore;
    try {
      await objects.putPrivateAppraisalImage({
        appraisalId: appraisal.id,
        mediaId: inserted.record.id,
        body: stripped.bytes,
        contentType: inspection.contentType,
        byteSize: stripped.bytes.byteLength,
        sha256,
      });
    } catch {
      try {
        await repository.deleteById(inserted.record.id);
      } catch {
        console.error("appraisal_media_compensation_failed", { mediaId: inserted.record.id });
      }
      throw new ApiError(503, "MEDIA_STORAGE_UNAVAILABLE", "No pudimos guardar la foto.");
    }
    return json({ data: publicMediaDto(inserted.record) }, { status: 201 });
  });
}

export function adminAppraisalPhotoList(
  request: Request,
  idValue: string,
  runtime: AppraisalMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async () => {
    if (request.method !== "GET") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const appraisalId = resourceId(idValue);
    const repository = runtime.repository ?? new D1AppraisalMediaRepository();
    const appraisal = await repository.findAppraisalById(appraisalId);
    if (!appraisal) {
      throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "La tasación no existe.");
    }
    return adminData((await repository.listByAppraisal(appraisalId)).map(adminMediaDto));
  });
}

export function adminAppraisalPhotoBytes(
  request: Request,
  idValue: string,
  mediaIdValue: string,
  runtime: AppraisalMediaRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async () => {
    if (request.method !== "GET") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "El método no está permitido.");
    }
    const appraisalId = resourceId(idValue);
    const mediaId = resourceId(mediaIdValue);
    const repository = runtime.repository ?? new D1AppraisalMediaRepository();
    const media = await repository.findByMediaId(appraisalId, mediaId);
    if (!media) {
      throw new ApiError(404, "ADMIN_RESOURCE_NOT_FOUND", "La foto no existe.");
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
  });
}
