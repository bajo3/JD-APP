import { getD1Binding } from "@/db";

export type ConsignmentIntakeRecord = Readonly<{
  id: string;
  publicCode: string;
  leadId: string | null;
  commandHash: string;
  status: string;
  createdAt: string;
}>;

export type CreateConsignmentIntakeInput = Readonly<{
  consignmentId: string;
  leadId: string;
  consentId: string;
  publicCode: string;
  idempotencyKey: string;
  commandHash: string;
  uploadTokenHash: string;
  owner: Readonly<{
    name: string;
    phoneNormalized: string;
    email: string | null;
    source: string;
  }>;
  vehicle: Readonly<{
    make: string;
    model: string;
    trim: string | null;
    year: number;
    mileageKm: number;
    declaredCondition: string;
    askingPriceCents: number | null;
    ownerNotes: string | null;
  }>;
  consent: Readonly<{
    channel: string;
    purpose: string;
    evidenceJson: string;
  }>;
  occurredAt: string;
}>;

export type ConsignmentIntakeResult =
  | { ok: true; record: ConsignmentIntakeRecord; replayed: boolean }
  | { ok: false; reason: "idempotency_conflict" };

export type ConsignmentIntakeRepositoryLike = Pick<
  D1ConsignmentIntakeRepository,
  "create" | "findConsignmentByIdempotencyKey" | "findLeadRequestHash"
>;

type ConsignmentSqlRow = {
  id: string;
  public_code: string;
  lead_id: string | null;
  command_hash: string;
  status: string;
  created_at: string;
};

function recordFromRow(row: ConsignmentSqlRow): ConsignmentIntakeRecord {
  return Object.freeze({
    id: String(row.id),
    publicCode: String(row.public_code),
    leadId: row.lead_id === null ? null : String(row.lead_id),
    commandHash: String(row.command_hash),
    status: String(row.status),
    createdAt: String(row.created_at),
  });
}

const CONSIGNMENT_SELECT = `SELECT
  id, public_code, lead_id, command_hash, status, created_at
FROM consignment`;

/**
 * Lead, consentimiento y consignación se crean en un único batch D1: una caída
 * entre requests no puede dejar un lead huérfano ni duplicar la oferta. La
 * misma clave reproduce el alta; la misma clave con otro comando queda en 409
 * sin escrituras.
 */
export class D1ConsignmentIntakeRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async findConsignmentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ConsignmentIntakeRecord | null> {
    const row = await this.d1
      .prepare(`${CONSIGNMENT_SELECT} WHERE idempotency_key = ? LIMIT 1`)
      .bind(idempotencyKey)
      .first<ConsignmentSqlRow>();
    return row ? recordFromRow(row) : null;
  }

  async findLeadRequestHash(idempotencyKey: string): Promise<string | null> {
    const row = await this.d1
      .prepare("SELECT create_request_hash AS requestHash FROM lead WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first<{ requestHash: string }>();
    return row ? String(row.requestHash) : null;
  }

  async create(input: CreateConsignmentIntakeInput): Promise<ConsignmentIntakeResult> {
    const existing = await this.findConsignmentByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.replayResult(existing, input);

    try {
      await this.d1.batch([
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
            input.commandHash,
            input.owner.name,
            input.owner.phoneNormalized,
            input.owner.email,
            input.owner.source,
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
            input.consent.channel,
            input.consent.purpose,
            input.occurredAt,
            input.consent.evidenceJson,
            input.occurredAt,
            input.leadId,
            input.idempotencyKey,
            input.commandHash,
          ),
        this.d1
          .prepare(
            `INSERT INTO consignment
             (id, public_code, idempotency_key, command_hash, upload_token_hash,
              lead_id, make, model, trim, year, mileage_km, declared_condition,
              asking_price_cents, owner_notes, status, version, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, lead.id, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 1, ?, ?
             FROM lead
             WHERE lead.id = ? AND lead.idempotency_key = ? AND lead.create_request_hash = ?`,
          )
          .bind(
            input.consignmentId,
            input.publicCode,
            input.idempotencyKey,
            input.commandHash,
            input.uploadTokenHash,
            input.vehicle.make,
            input.vehicle.model,
            input.vehicle.trim,
            input.vehicle.year,
            input.vehicle.mileageKm,
            input.vehicle.declaredCondition,
            input.vehicle.askingPriceCents,
            input.vehicle.ownerNotes,
            input.occurredAt,
            input.occurredAt,
            input.leadId,
            input.idempotencyKey,
            input.commandHash,
          ),
      ]);
    } catch (error) {
      const winner = await this.findConsignmentByIdempotencyKey(input.idempotencyKey);
      if (winner) return this.replayResult(winner, input);
      const leadHash = await this.findLeadRequestHash(input.idempotencyKey);
      if (leadHash !== null) return { ok: false, reason: "idempotency_conflict" };
      throw error;
    }

    const created = await this.findConsignmentByIdempotencyKey(input.idempotencyKey);
    if (!created) throw new Error("CONSIGNMENT_INTAKE_CREATE_FAILED");
    return { ok: true, record: created, replayed: false };
  }

  private replayResult(
    record: ConsignmentIntakeRecord,
    input: CreateConsignmentIntakeInput,
  ): ConsignmentIntakeResult {
    if (record.commandHash !== input.commandHash) {
      return { ok: false, reason: "idempotency_conflict" };
    }
    return { ok: true, record, replayed: true };
  }
}
