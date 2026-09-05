import { getD1Binding } from "@/db";

export type DemandRecord = Readonly<{
  id: string;
  publicCode: string;
  leadId: string;
  passportId: string;
  status: string;
  criteria: Record<string, unknown>;
  validUntil: string;
  assignedTo: string | null;
}>;

export type MatchRecord = Readonly<{
  id: string;
  demandId: string;
  vehicleId: string;
  scoreBps: number;
  status: string;
  notifiedTo: string | null;
}>;

export type PassportReviewRecord = Readonly<{
  id: string;
  status: string;
  version: number;
  budgetCents: number | null;
  currency: string;
  desiredMakes: readonly string[];
  desiredModels: readonly string[];
  acceptedTypes: readonly string[];
  minYear: number | null;
  maxMileageKm: number | null;
  tradeInDescription: string | null;
  urgencyDays: number | null;
  locality: string | null;
}>;

export type MatchStatus =
  | "NOTIFIED"
  | "RESPONDED"
  | "VISITED"
  | "PURCHASED"
  | "DISCARDED";

const STATUS_COLUMN: Readonly<Record<MatchStatus, string | null>> = {
  NOTIFIED: "notified_at",
  RESPONDED: "responded_at",
  VISITED: "visited_at",
  PURCHASED: "purchased_at",
  DISCARDED: null,
};

function jsonStringList(value: unknown): readonly string[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Demandas registradas y sus coincidencias.
 *
 * La demanda es lo que queda cuando la agencia no tiene el auto: no se
 * descarta la consulta, se guarda con vigencia. Y cada coincidencia guarda su
 * porcentaje **con el detalle que lo explica**, más el recorrido posterior
 * —respondió, visitó, compró—, que es lo único que después permite saber si el
 * criterio de coincidencia sirve.
 */
export class D1DemandRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async createPassport(input: {
    id: string;
    leadId: string;
    conversationId: string | null;
    reviewTokenHash?: string | null;
    budgetCents: number | null;
    downPaymentCents: number | null;
    maxMonthlyPaymentCents: number | null;
    currency: string;
    desiredMakes: readonly string[];
    desiredModels: readonly string[];
    acceptedTypes: readonly string[];
    minYear: number | null;
    maxMileageKm: number | null;
    primaryUse: string | null;
    needsFinancing: boolean | null;
    tradeInDescription: string | null;
    urgencyDays: number | null;
    locality: string | null;
    maxDistanceKm: number | null;
    mandatoryConditions: readonly string[];
    negotiableConditions: readonly string[];
    createdAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO buyer_passport
           (id, lead_id, conversation_id, review_token_hash, status, budget_cents, down_payment_cents,
            max_monthly_payment_cents, currency, desired_makes_json, desired_models_json,
            accepted_types_json, min_year, max_mileage_km, primary_use, needs_financing,
            trade_in_description, urgency_days, locality, max_distance_km,
            mandatory_conditions_json, negotiable_conditions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.id,
        input.leadId,
        input.conversationId,
        input.reviewTokenHash ?? null,
        input.budgetCents,
        input.downPaymentCents,
        input.maxMonthlyPaymentCents,
        input.currency,
        JSON.stringify([...input.desiredMakes]),
        JSON.stringify([...input.desiredModels]),
        JSON.stringify([...input.acceptedTypes]),
        input.minYear,
        input.maxMileageKm,
        input.primaryUse,
        input.needsFinancing === null ? null : input.needsFinancing,
        input.tradeInDescription,
        input.urgencyDays,
        input.locality,
        input.maxDistanceKm,
        JSON.stringify([...input.mandatoryConditions]),
        JSON.stringify([...input.negotiableConditions]),
        input.createdAt,
        input.createdAt,
      )
      .run();
  }

  async findPassportByReviewTokenHash(tokenHash: string): Promise<PassportReviewRecord | null> {
    const row = await this.d1
      .prepare(
        `SELECT id, status, version, budget_cents, currency, desired_makes_json,
                desired_models_json, accepted_types_json, min_year, max_mileage_km,
                trade_in_description, urgency_days, locality
           FROM buyer_passport
          WHERE review_token_hash = ?
          LIMIT 1`,
      )
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: String(row.id),
      status: String(row.status),
      version: Number(row.version),
      budgetCents: row.budget_cents === null ? null : Number(row.budget_cents),
      currency: String(row.currency),
      desiredMakes: jsonStringList(row.desired_makes_json),
      desiredModels: jsonStringList(row.desired_models_json),
      acceptedTypes: jsonStringList(row.accepted_types_json),
      minYear: row.min_year === null ? null : Number(row.min_year),
      maxMileageKm: row.max_mileage_km === null ? null : Number(row.max_mileage_km),
      tradeInDescription: row.trade_in_description === null ? null : String(row.trade_in_description),
      urgencyDays: row.urgency_days === null ? null : Number(row.urgency_days),
      locality: row.locality === null ? null : String(row.locality),
    };
  }

  async confirmPassportReview(input: {
    tokenHash: string;
    expectedVersion: number;
    budgetCents: number;
    currency: string;
    desiredMakes: readonly string[];
    desiredModels: readonly string[];
    acceptedTypes: readonly string[];
    minYear: number | null;
    maxMileageKm: number | null;
    tradeInDescription: string | null;
    urgencyDays: number | null;
    locality: string | null;
    demandId: string;
    demandPublicCode: string;
    criteria: unknown;
    validUntil: string;
    eventId: string;
    confirmedAt: string;
  }): Promise<"confirmed" | "not_found" | "conflict" | "already_confirmed"> {
    const nextVersion = input.expectedVersion + 1;
    const update = this.d1
      .prepare(
        `UPDATE buyer_passport
            SET status = 'CONFIRMED', budget_cents = ?, currency = ?,
                desired_makes_json = ?, desired_models_json = ?, accepted_types_json = ?,
                min_year = ?, max_mileage_km = ?, trade_in_description = ?, urgency_days = ?,
                locality = ?, confirmed_at = ?, updated_at = ?, version = ?
          WHERE review_token_hash = ? AND status = 'DRAFT' AND version = ?`,
      )
      .bind(
        input.budgetCents,
        input.currency,
        JSON.stringify([...input.desiredMakes]),
        JSON.stringify([...input.desiredModels]),
        JSON.stringify([...input.acceptedTypes]),
        input.minYear,
        input.maxMileageKm,
        input.tradeInDescription,
        input.urgencyDays,
        input.locality,
        input.confirmedAt,
        input.confirmedAt,
        nextVersion,
        input.tokenHash,
        input.expectedVersion,
      );
    const event = this.d1
      .prepare(
        `INSERT INTO lead_event (id, lead_id, type, actor_type, metadata_json, occurred_at)
         SELECT ?, lead_id, 'DEMAND_CONFIRMED_BY_CUSTOMER', 'CUSTOMER', ?, ?
           FROM buyer_passport
          WHERE changes() > 0
            AND review_token_hash = ? AND status = 'CONFIRMED' AND version = ?`,
      )
      .bind(
        input.eventId,
        JSON.stringify({ demandCode: input.demandPublicCode }),
        input.confirmedAt,
        input.tokenHash,
        nextVersion,
      );
    // `changes()` refiere al UPDATE anterior del mismo batch. Así, si otro
    // request ganó el CAS, tampoco queda un evento ni una demanda de rebote.
    const demand = this.d1
      .prepare(
        `INSERT INTO demand
           (id, public_code, passport_id, lead_id, status, criteria_json, valid_until,
            assigned_to, created_at, updated_at)
         SELECT ?, ?, p.id, p.lead_id, 'OPEN', ?, ?,
                (SELECT assigned_to FROM lead WHERE lead.id = p.lead_id), ?, ?
           FROM buyer_passport p
          WHERE p.review_token_hash = ? AND p.status = 'CONFIRMED' AND p.version = ?
            AND EXISTS (SELECT 1 FROM lead_event WHERE id = ?)
            AND NOT EXISTS (SELECT 1 FROM demand WHERE passport_id = p.id)`,
      )
      .bind(
        input.demandId,
        input.demandPublicCode,
        JSON.stringify(input.criteria),
        input.validUntil,
        input.confirmedAt,
        input.confirmedAt,
        input.tokenHash,
        nextVersion,
        input.eventId,
      );
    const [result] = await this.d1.batch([update, event, demand]);
    if (Number(result.meta?.changes ?? 0) > 0) return "confirmed";
    const current = await this.d1
      .prepare("SELECT status, version FROM buyer_passport WHERE review_token_hash = ?")
      .bind(input.tokenHash)
      .first<{ status: string; version: number }>();
    if (!current) return "not_found";
    if (String(current.status) === "CONFIRMED") return "already_confirmed";
    return "conflict";
  }

  /**
   * Confirmación del cliente. Sin esto el pasaporte queda en borrador y no
   * habilita una demanda: la IA propone los datos, la persona los aprueba.
   */
  async confirmPassport(input: { passportId: string; confirmedAt: string }): Promise<boolean> {
    const result = await this.d1
      .prepare(
        `UPDATE buyer_passport
            SET status = 'CONFIRMED', confirmed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND status = 'DRAFT'`,
      )
      .bind(input.confirmedAt, input.confirmedAt, input.passportId)
      .run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async createDemand(input: {
    id: string;
    publicCode: string;
    passportId: string;
    leadId: string;
    criteria: unknown;
    validUntil: string;
    assignedTo: string | null;
    createdAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO demand
           (id, public_code, passport_id, lead_id, status, criteria_json, valid_until,
            assigned_to, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?
           FROM buyer_passport
          WHERE id = ? AND status = 'CONFIRMED'`,
      )
      .bind(
        input.id,
        input.publicCode,
        input.passportId,
        input.leadId,
        JSON.stringify(input.criteria),
        input.validUntil,
        input.assignedTo,
        input.createdAt,
        input.createdAt,
        input.passportId,
      )
      .run();
  }

  /** Demandas vivas: abiertas y todavía vigentes. */
  async listOpenDemands(nowIso: string): Promise<DemandRecord[]> {
    const result = await this.d1
      .prepare(
        `SELECT id, public_code, passport_id, lead_id, status, criteria_json, valid_until, assigned_to
           FROM demand
          WHERE status = 'OPEN' AND valid_until > ?
          ORDER BY created_at ASC`,
      )
      .bind(nowIso)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      id: String(row.id),
      publicCode: String(row.public_code),
      passportId: String(row.passport_id),
      leadId: String(row.lead_id),
      status: String(row.status),
      criteria: JSON.parse(String(row.criteria_json)) as Record<string, unknown>,
      validUntil: String(row.valid_until),
      assignedTo: row.assigned_to === null ? null : String(row.assigned_to),
    }));
  }

  /**
   * Guarda las coincidencias de una unidad. Nace `NEW`: nadie recibió nada
   * todavía. El aviso es un paso aparte que aprueba una persona.
   */
  async saveMatches(
    matches: readonly {
      id: string;
      demandId: string;
      vehicleId: string;
      scoreBps: number;
      breakdown: unknown;
      createdAt: string;
    }[],
  ): Promise<void> {
    if (matches.length === 0) return;
    await this.d1.batch(
      matches.map((match) =>
        this.d1
          .prepare(
            `INSERT INTO demand_match
               (id, demand_id, vehicle_id, score_bps, breakdown_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?)
             ON CONFLICT(demand_id, vehicle_id) DO UPDATE SET
               score_bps = excluded.score_bps,
               breakdown_json = excluded.breakdown_json,
               updated_at = excluded.updated_at,
               version = demand_match.version + 1`,
          )
          .bind(
            match.id,
            match.demandId,
            match.vehicleId,
            match.scoreBps,
            JSON.stringify(match.breakdown),
            match.createdAt,
            match.createdAt,
          ),
      ),
    );
  }

  /**
   * Avanza el recorrido de una coincidencia. Cada estado sella su marca de
   * tiempo, así que después se puede medir cuántas coincidencias terminaron en
   * visita y cuántas en venta.
   */
  async markMatch(input: {
    matchId: string;
    status: MatchStatus;
    actor: string | null;
    occurredAt: string;
    reason?: string | null;
  }): Promise<boolean> {
    const column = STATUS_COLUMN[input.status];
    const sets = [
      "status = ?",
      "updated_at = ?",
      "version = version + 1",
      ...(column ? [`${column} = ?`] : []),
      ...(input.status === "NOTIFIED" ? ["notified_to = ?"] : []),
      ...(input.status === "DISCARDED" ? ["discarded_reason = ?"] : []),
    ];
    const bindings: unknown[] = [input.status, input.occurredAt];
    if (column) bindings.push(input.occurredAt);
    if (input.status === "NOTIFIED") bindings.push(input.actor);
    if (input.status === "DISCARDED") bindings.push(input.reason ?? null);
    bindings.push(input.matchId);
    const result = await this.d1
      .prepare(`UPDATE demand_match SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...bindings)
      .run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async listMatchesForVehicle(vehicleId: string): Promise<MatchRecord[]> {
    const result = await this.d1
      .prepare(
        `SELECT id, demand_id, vehicle_id, score_bps, status, notified_to
           FROM demand_match
          WHERE vehicle_id = ?
          ORDER BY score_bps DESC`,
      )
      .bind(vehicleId)
      .all<Record<string, unknown>>();
    return (result.results ?? []).map((row) => ({
      id: String(row.id),
      demandId: String(row.demand_id),
      vehicleId: String(row.vehicle_id),
      scoreBps: Number(row.score_bps),
      status: String(row.status),
      notifiedTo: row.notified_to === null ? null : String(row.notified_to),
    }));
  }
}

export type DemandRepositoryLike = Pick<
  D1DemandRepository,
  | "createPassport"
  | "findPassportByReviewTokenHash"
  | "confirmPassportReview"
  | "confirmPassport"
  | "createDemand"
  | "listOpenDemands"
  | "saveMatches"
  | "markMatch"
  | "listMatchesForVehicle"
>;
