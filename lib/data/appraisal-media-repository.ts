import { getD1Binding } from "@/db";

export const APPRAISAL_CAPTURE_TYPES = Object.freeze([
  "FRONT",
  "REAR",
  "SIDE_LEFT",
  "SIDE_RIGHT",
  "INTERIOR",
  "DASHBOARD",
] as const);

export type AppraisalCaptureType = (typeof APPRAISAL_CAPTURE_TYPES)[number];

export const APPRAISAL_CAPTURE_ORDER: Readonly<Record<AppraisalCaptureType, number>> =
  Object.freeze({
    FRONT: 0,
    REAR: 1,
    SIDE_LEFT: 2,
    SIDE_RIGHT: 3,
    INTERIOR: 4,
    DASHBOARD: 5,
  });

export type AppraisalMediaRecord = Readonly<{
  id: string;
  appraisalId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  captureType: AppraisalCaptureType;
  sortOrder: number;
  uploadedAt: string;
  createdAt: string;
}>;

export type AppraisalUploadResult =
  | { ok: true; record: AppraisalMediaRecord; replayed: boolean }
  | {
      ok: false;
      reason: "appraisal_not_found" | "appraisal_closed" | "capture_occupied" | "duplicate";
    };

type UploadReservation = Readonly<{
  mediaId: string;
  appraisalId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  captureType: AppraisalCaptureType;
}>;

type UploadContext = Readonly<{
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
}>;

type IdempotencyRow = { requestHash: string; resourceId: string };

const MEDIA_SELECT = `SELECT
  id, appraisal_id AS "appraisalId", r2_key AS "r2Key", content_type AS "contentType",
  byte_size AS "byteSize", sha256, capture_type AS "captureType",
  sort_order AS "sortOrder", uploaded_at AS "uploadedAt", created_at AS "createdAt"
FROM appraisal_media`;

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function mediaFromRow(row: Record<string, unknown>): AppraisalMediaRecord {
  return Object.freeze({
    id: String(row.id),
    appraisalId: String(row.appraisalId),
    r2Key: String(row.r2Key),
    contentType: String(row.contentType),
    byteSize: Number(row.byteSize),
    sha256: String(row.sha256),
    captureType: String(row.captureType) as AppraisalCaptureType,
    sortOrder: Number(row.sortOrder),
    uploadedAt: String(row.uploadedAt),
    createdAt: String(row.createdAt),
  });
}

export class D1AppraisalMediaRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async findAppraisalByPublicCode(
    publicCode: string,
  ): Promise<{ id: string; status: string } | null> {
    const row = await this.d1
      .prepare("SELECT id, status FROM appraisal WHERE public_code = ? LIMIT 1")
      .bind(publicCode)
      .first<{ id: string; status: string }>();
    return row ? { id: String(row.id), status: String(row.status) } : null;
  }

  async findAppraisalById(appraisalId: string): Promise<{ id: string; status: string } | null> {
    const row = await this.d1
      .prepare("SELECT id, status FROM appraisal WHERE id = ? LIMIT 1")
      .bind(appraisalId)
      .first<{ id: string; status: string }>();
    return row ? { id: String(row.id), status: String(row.status) } : null;
  }

  async listByAppraisal(appraisalId: string): Promise<AppraisalMediaRecord[]> {
    const result = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE appraisal_id = ? ORDER BY sort_order, created_at`)
      .bind(appraisalId)
      .all<Record<string, unknown>>();
    return result.results.map(mediaFromRow);
  }

  async findByMediaId(appraisalId: string, mediaId: string): Promise<AppraisalMediaRecord | null> {
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE appraisal_id = ? AND id = ? LIMIT 1`)
      .bind(appraisalId, mediaId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async findUploadReplay(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<"conflict" | AppraisalMediaRecord | null> {
    const replay = await this.d1
      .prepare(
        `SELECT request_hash AS "requestHash", resource_id AS "resourceId"
         FROM admin_idempotency
         WHERE scope = 'appraisal_media.upload' AND idempotency_key = ? LIMIT 1`,
      )
      .bind(idempotencyKey)
      .first<IdempotencyRow>();
    if (!replay) return null;
    if (replay.requestHash !== requestHash) return "conflict";
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE id = ? LIMIT 1`)
      .bind(replay.resourceId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async insertUpload(
    input: UploadReservation,
    context: UploadContext,
  ): Promise<AppraisalUploadResult> {
    const replay = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
    if (replay === "conflict") return { ok: false, reason: "duplicate" };
    if (replay) return { ok: true, record: replay, replayed: true };

    let results;
    try {
      results = await this.d1.batch([
        this.d1.prepare(
          `INSERT INTO admin_idempotency
           (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
           SELECT ?, 'appraisal_media.upload', ?, ?, 'appraisal_media', ?, 'public:appraisal-photo'
           WHERE EXISTS (SELECT 1 FROM appraisal WHERE id = ? AND status = 'SUBMITTED')
             AND NOT EXISTS (
               SELECT 1 FROM appraisal_media WHERE appraisal_id = ? AND capture_type = ?
             )
           ON CONFLICT(scope, idempotency_key) DO NOTHING`,
        ).bind(
          crypto.randomUUID(),
          context.idempotencyKey,
          context.requestHash,
          input.mediaId,
          input.appraisalId,
          input.appraisalId,
          input.captureType,
        ),
        this.d1.prepare(
          `INSERT INTO appraisal_media
           (id, appraisal_id, r2_key, content_type, byte_size, sha256,
            capture_type, sort_order, uploaded_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM admin_idempotency
             WHERE scope = 'appraisal_media.upload' AND idempotency_key = ?
               AND request_hash = ? AND resource_id = ?
           )
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          input.mediaId,
          input.appraisalId,
          input.r2Key,
          input.contentType,
          input.byteSize,
          input.sha256,
          input.captureType,
          APPRAISAL_CAPTURE_ORDER[input.captureType],
          context.occurredAt,
          context.occurredAt,
          context.idempotencyKey,
          context.requestHash,
          input.mediaId,
        ),
      ]);
    } catch {
      const winner = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
      if (winner && winner !== "conflict") return { ok: true, record: winner, replayed: true };
      const occupied = await this.d1
        .prepare("SELECT 1 AS present FROM appraisal_media WHERE appraisal_id = ? AND capture_type = ? LIMIT 1")
        .bind(input.appraisalId, input.captureType)
        .first<{ present: number }>();
      if (occupied) return { ok: false, reason: "capture_occupied" };
      return { ok: false, reason: "duplicate" };
    }

    if (changes(results[0] as D1Result<unknown>) === 0) {
      const appraisal = await this.findAppraisalById(input.appraisalId);
      if (!appraisal) return { ok: false, reason: "appraisal_not_found" };
      if (appraisal.status !== "SUBMITTED") return { ok: false, reason: "appraisal_closed" };
      const occupied = await this.d1
        .prepare("SELECT 1 AS present FROM appraisal_media WHERE appraisal_id = ? AND capture_type = ? LIMIT 1")
        .bind(input.appraisalId, input.captureType)
        .first<{ present: number }>();
      if (occupied) return { ok: false, reason: "capture_occupied" };
      const retry = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
      if (retry && retry !== "conflict") return { ok: true, record: retry, replayed: true };
      return { ok: false, reason: "duplicate" };
    }

    const record = await this.findByMediaId(input.appraisalId, input.mediaId);
    if (!record) throw new Error("APPRAISAL_MEDIA_INSERT_FAILED");
    return { ok: true, record, replayed: false };
  }

  async deleteById(mediaId: string): Promise<void> {
    await this.d1.prepare("DELETE FROM appraisal_media WHERE id = ?").bind(mediaId);
  }
}
