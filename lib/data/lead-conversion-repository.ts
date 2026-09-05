import { getD1Binding } from "@/db";
import type { LeadRow } from "@/db/schema";

export type ContextualSelection = Readonly<{
  interestId: string;
  simulationId: string;
  simulationCode: string;
  vehicleId: string;
  vehicleSlug: string;
  promotionId: string | null;
  contextJson: string;
}>;

export type CreateLeadConversionInput = Readonly<{
  leadId: string;
  idempotencyKey: string;
  requestHash: string;
  name: string;
  phoneNormalized: string;
  email: string | null;
  source: string;
  occurredAt: string;
  consentId: string;
  consentChannel: string;
  consentPurpose: string;
  consentEvidenceJson: string;
  context: ContextualSelection | null;
}>;

export type LeadConversionResult =
  | { ok: true; lead: LeadRow; replayed: boolean }
  | {
      ok: false;
      reason:
        | "idempotency_conflict"
        | "simulation_not_found"
        | "context_mismatch"
        | "simulation_already_linked";
    };

export type LinkedLeadContext = Readonly<{
  leadId: string;
  simulationId: string;
  simulationCode: string;
  simulationLeadId: string;
  vehicleId: string;
  vehicleSlug: string;
  vehicleLabel: string;
  vehicleYear: number;
  promotionId: string | null;
}>;

export type HandoffEventInput = Readonly<{
  eventId: string;
  leadId: string;
  simulationId: string;
  simulationCode: string;
  vehicleId: string;
  vehicleSlug: string;
  requestHash: string;
  occurredAt: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type HandoffEventResult =
  | { ok: true; replayed: boolean }
  | { ok: false; reason: "idempotency_conflict" | "context_not_linked" };

export interface LeadConversionRepository {
  findLeadByIdempotencyKey(key: string): Promise<LeadRow | null>;
  create(input: CreateLeadConversionInput): Promise<LeadConversionResult>;
  findLinkedContext(input: {
    leadId: string;
    simulationCode: string;
    vehicleSlug: string;
  }): Promise<LinkedLeadContext | null>;
  recordHandoff(input: HandoffEventInput): Promise<HandoffEventResult>;
}

type LeadSqlRow = Record<string, unknown>;

const LEAD_SELECT = `SELECT
  id, idempotency_key AS "idempotencyKey",
  create_request_hash AS "createRequestHash", name,
  phone_normalized AS "phoneNormalized", email, source, status, score,
  assigned_to AS "assignedTo", lost_reason AS "lostReason",
  last_contacted_at AS "lastContactedAt", version,
  created_at AS "createdAt", updated_at AS "updatedAt"
FROM lead`;

function leadFromRow(row: LeadSqlRow): LeadRow {
  return {
    id: String(row.id),
    idempotencyKey: row.idempotencyKey === null ? null : String(row.idempotencyKey),
    createRequestHash:
      row.createRequestHash === null ? null : String(row.createRequestHash),
    name: String(row.name),
    phoneNormalized: String(row.phoneNormalized),
    email: row.email === null ? null : String(row.email),
    source: String(row.source),
    status: String(row.status),
    score: Number(row.score),
    assignedTo: row.assignedTo === null ? null : String(row.assignedTo),
    lostReason: row.lostReason === null ? null : String(row.lostReason),
    lastContactedAt:
      row.lastContactedAt === null ? null : String(row.lastContactedAt),
    version: Number(row.version),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function eventHash(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>).requestHash;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export class D1LeadConversionRepository implements LeadConversionRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async findLeadByIdempotencyKey(key: string): Promise<LeadRow | null> {
    const row = await this.d1
      .prepare(`${LEAD_SELECT} WHERE idempotency_key = ? LIMIT 1`)
      .bind(key)
      .first<LeadSqlRow>();
    return row ? leadFromRow(row) : null;
  }

  async create(input: CreateLeadConversionInput): Promise<LeadConversionResult> {
    const replay = await this.findLeadByIdempotencyKey(input.idempotencyKey);
    if (replay) return this.replayResult(replay, input);

    const statements: D1PreparedStatement[] = [
      this.d1
        .prepare(
          `INSERT INTO lead
           (id, idempotency_key, create_request_hash, name, phone_normalized,
            email, source, status, score, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', 0, 1, ?, ?)`,
        )
        .bind(
          input.leadId,
          input.idempotencyKey,
          input.requestHash,
          input.name,
          input.phoneNormalized,
          input.email,
          input.source,
          input.occurredAt,
          input.occurredAt,
        ),
      this.d1
        .prepare(
          `INSERT INTO consent
           (id, lead_id, channel, purpose, granted_at, evidence_json, created_at)
           SELECT ?, id, ?, ?, ?, ?, ? FROM lead
           WHERE id = ? AND idempotency_key = ? AND create_request_hash = ?`,
        )
        .bind(
          input.consentId,
          input.consentChannel,
          input.consentPurpose,
          input.occurredAt,
          input.consentEvidenceJson,
          input.occurredAt,
          input.leadId,
          input.idempotencyKey,
          input.requestHash,
        ),
    ];

    if (input.context) {
      const context = input.context;
      statements.push(
        this.d1
          .prepare(
            `UPDATE simulation SET lead_id = ?
             WHERE id = ? AND public_code = ? AND vehicle_id = ?
               AND (lead_id IS NULL OR lead_id = ?)`,
          )
          .bind(
            input.leadId,
            context.simulationId,
            context.simulationCode,
            context.vehicleId,
            input.leadId,
          ),
        this.d1
          .prepare(
            `INSERT INTO lead_interest
             (id, lead_id, kind, vehicle_id, appraisal_id, simulation_id,
              promotion_id, context_json, created_at)
             VALUES (?, ?, 'SIMULATION', ?, NULL, ?, ?,
               (SELECT ? FROM simulation AS simulation
                JOIN vehicle AS vehicle ON vehicle.id = simulation.vehicle_id
                WHERE simulation.id = ? AND simulation.public_code = ?
                  AND simulation.vehicle_id = ? AND simulation.lead_id = ?
                  AND vehicle.slug = ?), ?)`,
          )
          .bind(
            context.interestId,
            input.leadId,
            context.vehicleId,
            context.simulationId,
            context.promotionId,
            context.contextJson,
            context.simulationId,
            context.simulationCode,
            context.vehicleId,
            input.leadId,
            context.vehicleSlug,
            input.occurredAt,
          ),
      );
    }

    try {
      await this.d1.batch(statements);
    } catch (error) {
      const winner = await this.findLeadByIdempotencyKey(input.idempotencyKey);
      if (winner) return this.replayResult(winner, input);
      if (input.context) return this.classifyContextFailure(input.context);
      throw error;
    }

    const lead = await this.findLeadByIdempotencyKey(input.idempotencyKey);
    if (!lead) throw new Error("LEAD_CONVERSION_CREATE_FAILED");
    return { ok: true, lead, replayed: false };
  }

  async findLinkedContext(input: {
    leadId: string;
    simulationCode: string;
    vehicleSlug: string;
  }): Promise<LinkedLeadContext | null> {
    const row = await this.d1
      .prepare(
        `SELECT lead.id AS "leadId", simulation.id AS "simulationId",
                simulation.public_code AS "simulationCode",
                simulation.lead_id AS "simulationLeadId",
                vehicle.id AS "vehicleId", vehicle.slug AS "vehicleSlug",
                vehicle.make || ' ' || vehicle.model || ' ' || vehicle.trim AS "vehicleLabel",
                vehicle.year AS "vehicleYear", simulation.promotion_id AS "promotionId"
         FROM lead
         JOIN lead_interest AS interest
           ON interest.lead_id = lead.id AND interest.kind = 'SIMULATION'
         JOIN simulation ON simulation.id = interest.simulation_id
         JOIN vehicle ON vehicle.id = simulation.vehicle_id
         WHERE lead.id = ? AND simulation.public_code = ? AND vehicle.slug = ?
           AND simulation.lead_id = lead.id
           AND interest.vehicle_id = simulation.vehicle_id
         LIMIT 1`,
      )
      .bind(input.leadId, input.simulationCode, input.vehicleSlug)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return Object.freeze({
      leadId: String(row.leadId),
      simulationId: String(row.simulationId),
      simulationCode: String(row.simulationCode),
      simulationLeadId: String(row.simulationLeadId),
      vehicleId: String(row.vehicleId),
      vehicleSlug: String(row.vehicleSlug),
      vehicleLabel: String(row.vehicleLabel),
      vehicleYear: Number(row.vehicleYear),
      promotionId: row.promotionId === null ? null : String(row.promotionId),
    });
  }

  async recordHandoff(input: HandoffEventInput): Promise<HandoffEventResult> {
    const existing = await this.findEvent(input.eventId);
    if (existing) {
      return eventHash(existing.metadataJson) === input.requestHash
        ? { ok: true, replayed: true }
        : { ok: false, reason: "idempotency_conflict" };
    }
    const metadataJson = JSON.stringify({ ...input.metadata, requestHash: input.requestHash });
    try {
      await this.d1
        .prepare(
          `INSERT INTO lead_event
           (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at, created_at)
           VALUES (?, ?, 'WHATSAPP_HANDOFF_CREATED', 'CUSTOMER', NULL,
             (SELECT ? FROM lead_interest AS interest
              JOIN simulation ON simulation.id = interest.simulation_id
              JOIN vehicle ON vehicle.id = simulation.vehicle_id
              WHERE interest.lead_id = ? AND interest.kind = 'SIMULATION'
                AND simulation.id = ? AND simulation.public_code = ?
                AND simulation.lead_id = ? AND simulation.vehicle_id = ?
                AND interest.vehicle_id = simulation.vehicle_id
                AND vehicle.slug = ?), ?, ?)`,
        )
        .bind(
          input.eventId,
          input.leadId,
          metadataJson,
          input.leadId,
          input.simulationId,
          input.simulationCode,
          input.leadId,
          input.vehicleId,
          input.vehicleSlug,
          input.occurredAt,
          input.occurredAt,
        )
        .run();
    } catch {
      const winner = await this.findEvent(input.eventId);
      if (winner) {
        return eventHash(winner.metadataJson) === input.requestHash
          ? { ok: true, replayed: true }
          : { ok: false, reason: "idempotency_conflict" };
      }
      return { ok: false, reason: "context_not_linked" };
    }
    return { ok: true, replayed: false };
  }

  private async replayResult(
    lead: LeadRow,
    input: CreateLeadConversionInput,
  ): Promise<LeadConversionResult> {
    if (lead.createRequestHash !== input.requestHash) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    if (input.context) {
      const linked = await this.findLinkedContext({
        leadId: lead.id,
        simulationCode: input.context.simulationCode,
        vehicleSlug: input.context.vehicleSlug,
      });
      if (!linked || linked.simulationId !== input.context.simulationId) {
        return { ok: false, reason: "context_mismatch" };
      }
    }
    return { ok: true, lead, replayed: true };
  }

  private async classifyContextFailure(
    context: ContextualSelection,
  ): Promise<LeadConversionResult> {
    const row = await this.d1
      .prepare(
        `SELECT simulation.lead_id AS "leadId", simulation.vehicle_id AS "vehicleId",
                vehicle.slug AS "vehicleSlug"
         FROM simulation
         LEFT JOIN vehicle ON vehicle.id = simulation.vehicle_id
         WHERE simulation.id = ? AND simulation.public_code = ? LIMIT 1`,
      )
      .bind(context.simulationId, context.simulationCode)
      .first<Record<string, unknown>>();
    if (!row) return { ok: false, reason: "simulation_not_found" };
    if (row.leadId !== null) return { ok: false, reason: "simulation_already_linked" };
    return { ok: false, reason: "context_mismatch" };
  }

  private async findEvent(
    id: string,
  ): Promise<{ metadataJson: string } | null> {
    return this.d1
      .prepare("SELECT metadata_json AS \"metadataJson\" FROM lead_event WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ metadataJson: string }>();
  }
}
