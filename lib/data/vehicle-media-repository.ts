import { getD1Binding } from "@/db";
import type { AdminActor } from "./admin-repositories";

export type VehicleMediaStatus = "PENDING" | "READY" | "ARCHIVED" | "FAILED";

export type VehicleMediaRecord = Readonly<{
  id: string;
  vehicleId: string;
  r2Key: string;
  publicUrl: string | null;
  contentType: string;
  altText: string;
  byteSize: number;
  sha256: string;
  status: VehicleMediaStatus;
  sortOrder: number;
  width: number | null;
  height: number | null;
  version: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>;

export type MediaMutationResult<T> =
  | { ok: true; record: T; vehicleVersion: number; replayed?: boolean }
  | { ok: false; reason: "not_found" | "version_conflict" | "duplicate"; currentVersion?: number };

type UploadContext = Readonly<{
  idempotencyKey: string;
  requestHash: string;
  expectedVehicleVersion: number;
  actor: AdminActor;
  occurredAt: string;
}>;

type UploadReservation = Readonly<{
  mediaId: string;
  vehicleId: string;
  r2Key: string;
  publicUrl: string;
  contentType: string;
  altText: string;
  byteSize: number;
  sha256: string;
}>;

type IdempotencyRow = {
  requestHash: string;
  resourceId: string;
};

function changes(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function mediaFromRow(row: Record<string, unknown>): VehicleMediaRecord {
  return Object.freeze({
    id: String(row.id),
    vehicleId: String(row.vehicleId),
    r2Key: String(row.r2Key),
    publicUrl: row.publicUrl === null ? null : String(row.publicUrl),
    contentType: String(row.contentType),
    altText: String(row.altText),
    byteSize: Number(row.byteSize),
    sha256: String(row.sha256),
    status: String(row.status) as VehicleMediaStatus,
    sortOrder: Number(row.sortOrder),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    version: Number(row.version),
    uploadedBy: String(row.uploadedBy),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    archivedAt: row.archivedAt === null ? null : String(row.archivedAt),
  });
}

const MEDIA_SELECT = `SELECT
  id, vehicle_id AS "vehicleId", r2_key AS "r2Key", public_url AS "publicUrl",
  content_type AS "contentType", alt_text AS "altText", byte_size AS "byteSize",
  sha256, status, sort_order AS "sortOrder", width, height, version,
  uploaded_by AS "uploadedBy", created_at AS "createdAt", updated_at AS "updatedAt",
  archived_at AS "archivedAt"
FROM vehicle_media`;

export class D1VehicleMediaRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async listAdmin(vehicleId: string): Promise<VehicleMediaRecord[]> {
    const result = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE vehicle_id = ? ORDER BY sort_order, created_at`)
      .bind(vehicleId)
      .all<Record<string, unknown>>();
    return result.results.map(mediaFromRow);
  }

  async findById(vehicleId: string, mediaId: string): Promise<VehicleMediaRecord | null> {
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE vehicle_id = ? AND id = ? LIMIT 1`)
      .bind(vehicleId, mediaId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async findPublic(mediaId: string): Promise<VehicleMediaRecord | null> {
    const row = await this.d1
      .prepare(
        `${MEDIA_SELECT}
         WHERE id = ? AND status = 'READY'
           AND EXISTS (SELECT 1 FROM vehicle WHERE vehicle.id = vehicle_media.vehicle_id AND vehicle.status = 'AVAILABLE')
         LIMIT 1`,
      )
      .bind(mediaId)
      .first<Record<string, unknown>>();
    return row ? mediaFromRow(row) : null;
  }

  async findUploadReplay(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<"conflict" | VehicleMediaRecord | null> {
    const replay = await this.d1
      .prepare(
        `SELECT request_hash AS "requestHash", resource_id AS "resourceId"
         FROM admin_idempotency
         WHERE scope = 'vehicle_media.upload' AND idempotency_key = ? LIMIT 1`,
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

  async reserveUpload(
    input: UploadReservation,
    context: UploadContext,
  ): Promise<MediaMutationResult<VehicleMediaRecord>> {
    const replay = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
    if (replay === "conflict") return { ok: false, reason: "duplicate" };
    if (replay) {
      return {
        ok: true,
        record: replay,
        vehicleVersion: await this.findVehicleVersion(input.vehicleId) ?? context.expectedVehicleVersion,
        replayed: true,
      };
    }
    const duplicate = await this.d1
      .prepare("SELECT id FROM vehicle_media WHERE vehicle_id = ? AND sha256 = ? LIMIT 1")
      .bind(input.vehicleId, input.sha256)
      .first<{ id: string }>();
    if (duplicate) return { ok: false, reason: "duplicate" };

    const nextVehicleVersion = context.expectedVehicleVersion + 1;
    try {
      const results = await this.d1.batch([
        this.d1.prepare(
          "UPDATE vehicle SET version = ?, updated_at = ? WHERE id = ? AND version = ?",
        ).bind(nextVehicleVersion, context.occurredAt, input.vehicleId, context.expectedVehicleVersion),
        this.d1.prepare(
          `INSERT INTO admin_idempotency
           (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
           SELECT ?, 'vehicle_media.upload', ?, ?, 'vehicle_media', ?, ? WHERE changes() > 0
           ON CONFLICT(scope, idempotency_key) DO NOTHING`,
        ).bind(
          crypto.randomUUID(), context.idempotencyKey, context.requestHash,
          input.mediaId, context.actor.userId,
        ),
        this.d1.prepare(
          `INSERT INTO vehicle_media
           (id, vehicle_id, r2_key, public_url, content_type, alt_text, byte_size,
            sha256, status, sort_order, version, uploaded_by, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING',
             COALESCE((SELECT MAX(sort_order) + 1 FROM vehicle_media WHERE vehicle_id = ?), 0),
             1, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM admin_idempotency
             WHERE scope = 'vehicle_media.upload' AND idempotency_key = ?
               AND request_hash = ? AND resource_id = ?
           )`,
        ).bind(
          input.mediaId, input.vehicleId, input.r2Key, input.publicUrl,
          input.contentType, input.altText, input.byteSize, input.sha256, input.vehicleId,
          context.actor.email, context.occurredAt, context.occurredAt,
          context.idempotencyKey, context.requestHash, input.mediaId,
        ),
      ]);
      if (changes(results[0] as D1Result<unknown>) === 0) {
        const currentVersion = await this.findVehicleVersion(input.vehicleId);
        return currentVersion === null
          ? { ok: false, reason: "not_found" }
          : { ok: false, reason: "version_conflict", currentVersion };
      }
    } catch {
      const winner = await this.findUploadReplay(context.idempotencyKey, context.requestHash);
      if (winner && winner !== "conflict") {
        return { ok: true, record: winner, vehicleVersion: nextVehicleVersion, replayed: true };
      }
      return { ok: false, reason: "duplicate" };
    }
    const record = await this.findById(input.vehicleId, input.mediaId);
    if (!record) throw new Error("VEHICLE_MEDIA_RESERVATION_FAILED");
    return { ok: true, record, vehicleVersion: nextVehicleVersion, replayed: false };
  }

  async markReady(mediaId: string, actor: AdminActor, occurredAt: string): Promise<VehicleMediaRecord> {
    const auditId = `vehicle-media-upload:${mediaId}`;
    await this.d1.batch([
      this.d1.prepare(
        `UPDATE vehicle_media
         SET status = 'READY', version = version + 1, updated_at = ?, archived_at = NULL
         WHERE id = ? AND status IN ('PENDING', 'FAILED')`,
      ).bind(occurredAt, mediaId),
      this.d1.prepare(
        `INSERT INTO admin_audit_log
         (id, actor_user_id, actor_email, action, resource_type, resource_id,
          previous_version, next_version, summary_json, occurred_at)
         SELECT ?, ?, ?, 'vehicle_media.upload', 'vehicle_media', id,
                version - 1, version, ?, ?
         FROM vehicle_media WHERE id = ? AND status = 'READY'
         ON CONFLICT(id) DO NOTHING`,
      ).bind(auditId, actor.userId, actor.email, JSON.stringify({ status: "READY" }), occurredAt, mediaId),
    ]);
    const row = await this.d1
      .prepare(`${MEDIA_SELECT} WHERE id = ? LIMIT 1`)
      .bind(mediaId)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("VEHICLE_MEDIA_READY_FAILED");
    return mediaFromRow(row);
  }

  async markFailed(mediaId: string, actor: AdminActor, occurredAt: string): Promise<void> {
    await this.d1.batch([
      this.d1.prepare(
        `UPDATE vehicle_media SET status = 'FAILED', version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(occurredAt, mediaId)
      ,
      this.d1.prepare(
        `INSERT INTO admin_audit_log
         (id, actor_user_id, actor_email, action, resource_type, resource_id,
          previous_version, next_version, summary_json, occurred_at)
         SELECT ?, ?, ?, 'vehicle_media.failed', 'vehicle_media', id,
                version - 1, version, ?, ?
         FROM vehicle_media WHERE id = ? AND status = 'FAILED' AND changes() > 0
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        `vehicle-media-failed:${mediaId}`,
        actor.userId,
        actor.email,
        JSON.stringify({ status: "FAILED" }),
        occurredAt,
        mediaId,
      ),
    ]);
  }

  async archive(
    vehicleId: string,
    mediaId: string,
    expectedVehicleVersion: number,
    actor: AdminActor,
    occurredAt: string,
  ): Promise<MediaMutationResult<VehicleMediaRecord>> {
    const current = await this.findById(vehicleId, mediaId);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status === "ARCHIVED") {
      return { ok: true, record: current, vehicleVersion: await this.findVehicleVersion(vehicleId) ?? expectedVehicleVersion };
    }
    const nextVehicleVersion = expectedVehicleVersion + 1;
    const [vehicleResult, mediaResult] = await this.d1.batch([
      this.d1.prepare(
        "UPDATE vehicle SET version = ?, updated_at = ? WHERE id = ? AND version = ?",
      ).bind(nextVehicleVersion, occurredAt, vehicleId, expectedVehicleVersion),
      this.d1.prepare(
        `UPDATE vehicle_media SET status = 'ARCHIVED', archived_at = ?, updated_at = ?,
         version = version + 1 WHERE id = ? AND vehicle_id = ? AND status != 'ARCHIVED' AND changes() > 0`,
      ).bind(occurredAt, occurredAt, mediaId, vehicleId),
      this.auditStatement(actor, "vehicle_media.archive", mediaId, current.version, current.version + 1, occurredAt),
    ]);
    if (changes(vehicleResult as D1Result<unknown>) === 0 || changes(mediaResult as D1Result<unknown>) === 0) {
      const currentVersion = await this.findVehicleVersion(vehicleId);
      return currentVersion === null
        ? { ok: false, reason: "not_found" }
        : { ok: false, reason: "version_conflict", currentVersion };
    }
    const record = await this.findById(vehicleId, mediaId);
    if (!record) return { ok: false, reason: "not_found" };
    return { ok: true, record, vehicleVersion: nextVehicleVersion };
  }

  async reorder(
    vehicleId: string,
    orderedIds: readonly string[],
    expectedVehicleVersion: number,
    actor: AdminActor,
    occurredAt: string,
  ): Promise<MediaMutationResult<VehicleMediaRecord[]>> {
    const ready = (await this.listAdmin(vehicleId)).filter((item) => item.status === "READY");
    if (
      ready.length !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      ready.some((item) => !orderedIds.includes(item.id))
    ) {
      return { ok: false, reason: "not_found" };
    }
    const nextVehicleVersion = expectedVehicleVersion + 1;
    const cases = orderedIds.map(() => "WHEN ? THEN ?").join(" ");
    const binds = orderedIds.flatMap((id, index) => [id, index]);
    const placeholders = orderedIds.map(() => "?").join(",");
    const results = await this.d1.batch([
      this.d1.prepare(
        "UPDATE vehicle SET version = ?, updated_at = ? WHERE id = ? AND version = ?",
      ).bind(nextVehicleVersion, occurredAt, vehicleId, expectedVehicleVersion),
      this.d1.prepare(
        `UPDATE vehicle_media SET sort_order = CASE id ${cases} END,
           version = version + 1, updated_at = ?
         WHERE vehicle_id = ? AND status = 'READY' AND id IN (${placeholders}) AND changes() > 0`,
      ).bind(...binds, occurredAt, vehicleId, ...orderedIds),
      this.auditStatement(
        actor,
        "vehicle_media.reorder",
        vehicleId,
        expectedVehicleVersion,
        nextVehicleVersion,
        occurredAt,
        { orderedIds },
      ),
    ]);
    if (changes(results[0] as D1Result<unknown>) === 0) {
      const currentVersion = await this.findVehicleVersion(vehicleId);
      return currentVersion === null
        ? { ok: false, reason: "not_found" }
        : { ok: false, reason: "version_conflict", currentVersion };
    }
    return {
      ok: true,
      record: (await this.listAdmin(vehicleId)).filter((item) => item.status === "READY"),
      vehicleVersion: nextVehicleVersion,
    };
  }

  async findVehicleVersion(vehicleId: string): Promise<number | null> {
    const row = await this.d1
      .prepare("SELECT version FROM vehicle WHERE id = ? LIMIT 1")
      .bind(vehicleId)
      .first<{ version: number }>();
    return row ? Number(row.version) : null;
  }

  private auditStatement(
    actor: AdminActor,
    action: string,
    resourceId: string,
    previousVersion: number,
    nextVersion: number,
    occurredAt: string,
    metadata: Record<string, unknown> = {},
  ): D1PreparedStatement {
    return this.d1.prepare(
      `INSERT INTO admin_audit_log
       (id, actor_user_id, actor_email, action, resource_type, resource_id,
        previous_version, next_version, summary_json, occurred_at)
       SELECT ?, ?, ?, ?, 'vehicle_media', ?, ?, ?, ?, ? WHERE changes() > 0`,
    ).bind(
      crypto.randomUUID(), actor.userId, actor.email, action, resourceId,
      previousVersion, nextVersion, JSON.stringify(metadata), occurredAt,
    );
  }
}
