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
           (id, lead_id, conversation_id, status, budget_cents, down_payment_cents,
            max_monthly_payment_cents, currency, desired_makes_json, desired_models_json,
            accepted_types_json, min_year, max_mileage_km, primary_use, needs_financing,
            trade_in_description, urgency_days, locality, max_distance_km,
            mandatory_conditions_json, negotiable_conditions_json, created_at, updated_at)
         VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.leadId,
        input.conversationId,
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
        input.needsFinancing === null ? null : input.needsFinancing ? 1 : 0,
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
  | "confirmPassport"
  | "createDemand"
  | "listOpenDemands"
  | "saveMatches"
  | "markMatch"
  | "listMatchesForVehicle"
>;
