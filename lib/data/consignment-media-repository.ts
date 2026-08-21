import { getD1Binding } from "@/db";

export const CONSIGNMENT_CAPTURE_TYPES = Object.freeze([
  "FRONT",
  "REAR",
  "SIDE",
  "INTERIOR",
  "DASHBOARD",
] as const);

export type ConsignmentCaptureType = (typeof CONSIGNMENT_CAPTURE_TYPES)[number];

export const CONSIGNMENT_CAPTURE_ORDER: Readonly<Record<ConsignmentCaptureType, number>> =
  Object.freeze({
    FRONT: 0,
    REAR: 1,
    SIDE: 2,
    INTERIOR: 3,
    DASHBOARD: 4,
  });

export const CONSIGNMENT_REQUIRED_READY_PHOTOS = CONSIGNMENT_CAPTURE_TYPES.length;

export const CONSIGNMENT_MEDIA_STATUSES = Object.freeze([
  "PENDING",
  "READY",
  "FAILED",
  "ARCHIVED",
] as const);

export type ConsignmentMediaStatus = (typeof CONSIGNMENT_MEDIA_STATUSES)[number];

export type ConsignmentMediaRecord = Readonly<{
  id: string;
  consignmentId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  captureType: ConsignmentCaptureType;
  status: ConsignmentMediaStatus;
  requestHash: string;
  sortOrder: number;
  version: number;
  uploadedAt: string;
  updatedAt: string;
  createdAt: string;
}>;

export type ConsignmentUploadResult =
  | { ok: true; record: ConsignmentMediaRecord; replayed: boolean }
  | {
      ok: false;
      reason: "consignment_not_found" | "consignment_closed" | "capture_occupied" | "duplicate";
    };

type UploadReservation = Readonly<{
  mediaId: string;
  consignmentId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  captureType: ConsignmentCaptureType;
}>;

type UploadContext = Readonly<{
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
}>;

type IdempotencyRow = { requestHash: string; resourceId: string };

const MEDIA_SELECT = `SELECT
  id, consignment_id AS consignmentId, r2_key AS r2Key, content_type AS contentType,
  byte_size AS byteSize, sha256, capture_type AS captureType, status,
  request_hash AS requestHash, sort_order AS sortOrder, version,
  uploaded_at AS uploadedAt, updated_at AS updatedAt, created_at AS createdAt
FROM consignment_media`;

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function mediaFromRow(row: Record<string, unknown>): ConsignmentMediaRecord {
  return Object.freeze({
    id: String(row.id),
    consignmentId: String(row.consignmentId),
    r2Key: String(row.r2Key),
    contentType: String(row.contentType),
    byteSize: Number(row.byteSize),
    sha256: String(row.sha256),
    captureType: String(row.captureType) as ConsignmentCaptureType,
    status: String(row.status) as ConsignmentMediaStatus,
    requestHash: String(row.requestHash),
    sortOrder: Number(row.sortOrder),
    version: Number(row.version),
    uploadedAt: String(row.uploadedAt),
    updatedAt: String(row.updatedAt),
    createdAt: String(row.createdAt),
  });
}

export class D1ConsignmentMediaRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async findConsignmentByPublicCode(
    publicCode: string,
  ): Promise<{ id: string; status: string; uploadTokenHash: string | null } | null> {
    const row = await this.d1
      .prepare("SELECT id, status, upload_token_hash AS uploadTokenHash FROM consignment WHERE public_code = ? LIMIT 1")
      .bind(publicCode)
      .first<{ id: string; status: string; uploadTokenHash: string | null }>();
    return row
      ? {
          id: String(row.id),
          status: String(row.status),
          uploadTokenHash: row.uploadTokenHash === null ? null : String(row.uploadTokenHash),
        }
      : null;
  }

  async findConsignmentById(
    consignmentId: string,
  ): Promise<{ id: string; status: string } | null> {
    const row = await this.d1
      .prepare("SELECT id, status FROM consignment WHERE id = ? LIMIT 1")
      .bind(consignmentId)
      .first<{ id: string; status: string }>();
    return row ? { id: String(row.id), status: String(row.status) } : null;
  }

  async listReadyByConsignment(consignmentId: string): Promise<ConsignmentMediaRecord[]> {
    const result = await this.d1
      .prepare(
        `${MEDIA_SELECT} WHERE consignment_id = ? AND status = 'READY' ORDER BY sort_order, created_at`,
      )
      .bind(consignmentId)
      .all<Record<string, unknown>>();
    return result.results.map(mediaFromRow);
  }

  async countReadyByConsignment(consignmentId: string): Promise<number> {
    const row = await this.d1
      .prepare(
        "SELECT COUNT(*) AS total FROM consignment_media WHERE consignment_id = ? AND status = 'READY'",
      )
      .bind(consignmentId)
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async findReadyByMediaId(
    consignmentId: string,
    mediaId: string,
  ): Promise<ConsignmentMediaRecord | null> {
    const row = await this.d1
      .prepare(
        `${MEDIA_SELECT} WHERE consignment_id = ? AND id = ? AND status = 'READY' LIMIT 1`,
      )
      .bind(consignmentId, mediaId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async findUploadReplay(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<"conflict" | ConsignmentMediaRecord | null> {
    const replay = await this.d1
      .prepare(
        `SELECT request_hash AS requestHash, resource_id AS resourceId
         FROM admin_idempotency
         WHERE scope = 'consignment_media.upload' AND idempotency_key = ? LIMIT 1`,
      )
      .bind(idempotencyKey)
      .first<IdempotencyRow>();
    if (!replay) return null;
    if (replay.requestHash !== requestHash) return "conflict";
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE id = ? AND status <> 'ARCHIVED' LIMIT 1`)
      .bind(replay.resourceId)
      .first<Record<string, unknown>>();
    if (!row) {
      // The reservation outlived its media row; free the key so it can be reused.
      await this.d1
        .prepare(
          "DELETE FROM admin_idempotency WHERE scope = 'consignment_media.upload' AND idempotency_key = ?",
        )
        .bind(idempotencyKey);
      return null;
    }
    return mediaFromRow(row);
  }

  async insertUpload(
    input: UploadReservation,
    context: UploadContext,
  ): Promise<ConsignmentUploadResult> {
    const replay = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
    if (replay === "conflict") return { ok: false, reason: "duplicate" };
    if (replay) return { ok: true, record: replay, replayed: true };

    let results;
    try {
      results = await this.d1.batch([
        // A FAILED reservation frees its slot so an honest retry can reoccupy it.
        this.d1
          .prepare(
            `UPDATE consignment_media
             SET status = 'ARCHIVED', version = version + 1, updated_at = ?
             WHERE consignment_id = ? AND capture_type = ? AND status = 'FAILED'`,
          )
          .bind(context.occurredAt, input.consignmentId, input.captureType),
        this.d1
          .prepare(
            `INSERT INTO admin_idempotency
             (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
             SELECT ?, 'consignment_media.upload', ?, ?, 'consignment_media', ?, 'public:consignment-photo'
             WHERE EXISTS (SELECT 1 FROM consignment WHERE id = ? AND status = 'SUBMITTED')
               AND NOT EXISTS (
                 SELECT 1 FROM consignment_media
                 WHERE consignment_id = ? AND capture_type = ? AND status <> 'ARCHIVED'
               )
             ON CONFLICT(scope, idempotency_key) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            context.idempotencyKey,
            context.requestHash,
            input.mediaId,
            input.consignmentId,
            input.consignmentId,
            input.captureType,
          ),
        this.d1
          .prepare(
            `INSERT INTO consignment_media
             (id, consignment_id, r2_key, content_type, byte_size, sha256,
              capture_type, status, request_hash, sort_order, version,
              uploaded_at, updated_at, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 1, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM admin_idempotency
               WHERE scope = 'consignment_media.upload' AND idempotency_key = ?
                 AND request_hash = ? AND resource_id = ?
             )
             ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            input.mediaId,
            input.consignmentId,
            input.r2Key,
            input.contentType,
            input.byteSize,
            input.sha256,
            input.captureType,
            context.requestHash,
            CONSIGNMENT_CAPTURE_ORDER[input.captureType],
            context.occurredAt,
            context.occurredAt,
            context.occurredAt,
            context.idempotencyKey,
            context.requestHash,
            input.mediaId,
          ),
      ]);
    } catch {
      return this.classifyInsertFailure(input, context);
    }

    if (changes(results[2] as D1Result<unknown>) === 0) {
      return this.classifyInsertFailure(input, context);
    }

    const record = await this.findByMediaId(input.consignmentId, input.mediaId);
    if (!record) throw new Error("CONSIGNMENT_MEDIA_INSERT_FAILED");
    return { ok: true, record, replayed: false };
  }

  private async classifyInsertFailure(
    input: UploadReservation,
    context: UploadContext,
  ): Promise<ConsignmentUploadResult> {
    const winner = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
    if (winner === "conflict") return { ok: false, reason: "duplicate" };
    if (winner) return { ok: true, record: winner, replayed: true };
    const consignment = await this.findConsignmentById(input.consignmentId);
    if (!consignment) return { ok: false, reason: "consignment_not_found" };
    if (consignment.status !== "SUBMITTED") return { ok: false, reason: "consignment_closed" };
    const occupied = await this.d1
      .prepare(
        `SELECT 1 AS present FROM consignment_media
         WHERE consignment_id = ? AND capture_type = ? AND status <> 'ARCHIVED' LIMIT 1`,
      )
      .bind(input.consignmentId, input.captureType)
      .first<{ present: number }>();
    if (occupied) return { ok: false, reason: "capture_occupied" };
    return { ok: false, reason: "duplicate" };
  }

  async findByMediaId(
    consignmentId: string,
    mediaId: string,
  ): Promise<ConsignmentMediaRecord | null> {
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE consignment_id = ? AND id = ? LIMIT 1`)
      .bind(consignmentId, mediaId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async confirmReady(mediaId: string, expectedVersion: number, occurredAt: string): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `UPDATE consignment_media
         SET status = 'READY', version = version + 1, updated_at = ?
         WHERE id = ? AND status IN ('PENDING', 'FAILED') AND version = ?`,
      )
      .bind(occurredAt, mediaId, expectedVersion)
      .run();
    return changes(result) === 1;
  }

  async markFailed(mediaId: string, occurredAt: string): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE consignment_media
         SET status = 'FAILED', version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(occurredAt, mediaId)
      .run();
  }

  async archiveStale(
    consignmentId: string,
    cutoffIso: string,
    occurredAt: string,
  ): Promise<ConsignmentMediaRecord[]> {
    const stale = await this.d1
      .prepare(
        `${MEDIA_SELECT} WHERE consignment_id = ? AND status IN ('PENDING', 'FAILED')
         AND updated_at < ?`,
      )
      .bind(consignmentId, cutoffIso)
      .all<Record<string, unknown>>();
    if (stale.results.length === 0) return [];
    await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE consignment_media
           SET status = 'ARCHIVED', version = version + 1, updated_at = ?
           WHERE consignment_id = ? AND status IN ('PENDING', 'FAILED') AND updated_at < ?`,
        )
        .bind(occurredAt, consignmentId, cutoffIso),
      this.d1
        .prepare(
          `DELETE FROM admin_idempotency
           WHERE scope = 'consignment_media.upload'
             AND resource_id IN (
               SELECT id FROM consignment_media
               WHERE consignment_id = ? AND status = 'ARCHIVED'
             )`,
        )
        .bind(consignmentId),
    ]);
    return stale.results.map(mediaFromRow);
  }
}
