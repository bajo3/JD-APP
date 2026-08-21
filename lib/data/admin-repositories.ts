import { and, count, desc, eq } from "drizzle-orm";
import { getD1Binding, getDb, type Database } from "@/db";
import {
  adminIdempotency,
  appraisals,
  consignments,
  consignmentMedia,
  financePlanTiers,
  financePlanVersions,
  leadInterests,
  leads,
  promotions,
  promotionVehicles,
  simulations,
  vehicles,
  type AppraisalRow,
  type ConsignmentRow,
  type FinancePlanTierRow,
  type FinancePlanVersionRow,
  type LeadRow,
  type PromotionRow,
  type VehicleRow,
} from "@/db/schema";

export type AdminActor = Readonly<{
  userId: string;
  email: string;
  displayName: string;
}>;

export type AdminAudit = Readonly<{
  action: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}>;

export type MutationResult<T> =
  | { ok: true; record: T; replayed?: boolean }
  | { ok: false; reason: "not_found" | "conflict"; currentVersion?: number };

export type IdempotentCreateResult<T> =
  | { ok: true; record: T; replayed: boolean }
  | { ok: false; reason: "idempotency_conflict" };

export type AdminOverview = Readonly<{
  vehiclesAvailable: number;
  vehiclesDraft: number;
  leadsNew: number;
  appraisalsPending: number;
  financeDrafts: number;
  promotionsScheduled: number;
}>;

export type AdminLeadContextRow = LeadRow & Readonly<{
  vehicleId: string | null;
  vehicleSlug: string | null;
  vehicleLabel: string | null;
  simulationCode: string | null;
}>;

type CreateContext = {
  idempotencyKey: string;
  requestHash: string;
  actor: AdminActor;
  audit: AdminAudit;
};

type CasContext = {
  expectedVersion: number;
  actor: AdminActor;
  audit: AdminAudit;
};

function auditStatement(
  d1: D1Database,
  input: {
    actor: AdminActor;
    audit: AdminAudit;
    resourceType: string;
    resourceId: string;
    previousVersion: number | null;
    nextVersion: number;
    table: "vehicle" | "lead" | "appraisal" | "consignment" | "finance_plan_version" | "promotion";
    versionColumn: "version" | "lock_version";
  },
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO admin_audit_log
       (id, actor_user_id, actor_email, action, resource_type, resource_id,
        previous_version, next_version, summary_json, occurred_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE changes() > 0
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.actor.userId,
      input.actor.email,
      input.audit.action,
      input.resourceType,
      input.resourceId,
      input.previousVersion,
      input.nextVersion,
      JSON.stringify(input.audit.metadata ?? {}),
      input.audit.occurredAt,
    );
}

function changes(result: D1Result<unknown>): number {
  return Number(result.meta?.changes ?? 0);
}

export class D1AdminRepository {
  constructor(
    private readonly d1: D1Database = getD1Binding(),
    private readonly db: Database = getDb(),
  ) {}

  async overview(): Promise<AdminOverview> {
    const result = await this.d1
      .prepare(
        `SELECT
          (SELECT count(*) FROM vehicle WHERE status = 'AVAILABLE') AS vehiclesAvailable,
          (SELECT count(*) FROM vehicle WHERE status = 'DRAFT') AS vehiclesDraft,
          (SELECT count(*) FROM lead WHERE status = 'NEW') AS leadsNew,
          (SELECT count(*) FROM appraisal WHERE status IN ('SUBMITTED', 'IN_REVIEW')) AS appraisalsPending,
          (SELECT count(*) FROM finance_plan_version WHERE status = 'DRAFT') AS financeDrafts,
          (SELECT count(*) FROM promotion WHERE status = 'SCHEDULED') AS promotionsScheduled`,
      )
      .first<Record<keyof AdminOverview, number>>();
    return {
      vehiclesAvailable: Number(result?.vehiclesAvailable ?? 0),
      vehiclesDraft: Number(result?.vehiclesDraft ?? 0),
      leadsNew: Number(result?.leadsNew ?? 0),
      appraisalsPending: Number(result?.appraisalsPending ?? 0),
      financeDrafts: Number(result?.financeDrafts ?? 0),
      promotionsScheduled: Number(result?.promotionsScheduled ?? 0),
    };
  }

  listVehicles(status?: string): Promise<VehicleRow[]> {
    return status
      ? this.db.select().from(vehicles).where(eq(vehicles.status, status)).orderBy(desc(vehicles.updatedAt))
      : this.db.select().from(vehicles).orderBy(desc(vehicles.updatedAt));
  }

  async findVehicleById(id: string): Promise<VehicleRow | null> {
    const [row] = await this.db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    return row ?? null;
  }

  async createVehicle(
    input: typeof vehicles.$inferInsert,
    context: CreateContext,
  ): Promise<IdempotentCreateResult<VehicleRow>> {
    const replay = await this.findIdempotency("vehicle.create", context);
    if (replay) {
      if (replay.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
      const record = await this.findVehicleById(replay.resourceId);
      if (record) return { ok: true, record, replayed: true };
    }
    const now = context.audit.occurredAt;
    const idempotencyId = crypto.randomUUID();
    const statements = [
      this.d1.prepare(
        `INSERT INTO admin_idempotency
         (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
         VALUES (?, 'vehicle.create', ?, ?, 'vehicle', ?, ?)
         ON CONFLICT(scope, idempotency_key) DO NOTHING`,
      ).bind(idempotencyId, context.idempotencyKey, context.requestHash, input.id, context.actor.userId),
      this.d1.prepare(
        `INSERT INTO vehicle
         (id, slug, external_code, make, model, trim, year, mileage_km, price_cents,
          currency, price_valid_until, body_type, fuel_type, transmission, color, status,
          source, last_synced_at, published_at, internal_notes, version, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM admin_idempotency
           WHERE scope = 'vehicle.create' AND idempotency_key = ? AND request_hash = ? AND resource_id = ?
         )
         ON CONFLICT(id) DO NOTHING`,
      ).bind(
        input.id, input.slug, input.externalCode ?? null, input.make, input.model, input.trim,
        input.year, input.mileageKm, input.priceCents, input.currency ?? "ARS",
        input.priceValidUntil ?? null, input.bodyType, input.fuelType, input.transmission,
        input.color, input.status ?? "DRAFT", input.source ?? "manual",
        input.lastSyncedAt ?? null, input.publishedAt ?? null, input.internalNotes ?? null,
        now, now, context.idempotencyKey, context.requestHash, input.id,
      ),
      auditStatement(this.d1, {
        actor: context.actor, audit: context.audit, resourceType: "vehicle", resourceId: input.id,
        previousVersion: null, nextVersion: 1, table: "vehicle", versionColumn: "version",
      }),
    ];
    await this.d1.batch(statements);
    const winner = await this.findIdempotency("vehicle.create", context);
    if (!winner || winner.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
    const record = await this.findVehicleById(winner.resourceId);
    if (!record) throw new Error("ADMIN_VEHICLE_CREATE_FAILED");
    return { ok: true, record, replayed: winner.resourceId !== input.id };
  }

  async updateVehicle(
    input: { id: string; patch: Partial<VehicleRow> } & CasContext,
  ): Promise<MutationResult<VehicleRow>> {
    const allowed: Array<[keyof VehicleRow, string]> = [
      ["slug", "slug"], ["externalCode", "external_code"], ["make", "make"], ["model", "model"], ["trim", "trim"],
      ["year", "year"], ["mileageKm", "mileage_km"], ["priceCents", "price_cents"],
      ["priceValidUntil", "price_valid_until"], ["bodyType", "body_type"],
      ["fuelType", "fuel_type"], ["transmission", "transmission"], ["color", "color"],
      ["status", "status"], ["source", "source"], ["internalNotes", "internal_notes"], ["publishedAt", "published_at"],
    ];
    const entries = allowed.filter(([key]) => Object.hasOwn(input.patch, key));
    if (entries.length === 0) return this.currentVehicleConflict(input.id, input.expectedVersion);
    const nextVersion = input.expectedVersion + 1;
    const setSql = entries.map(([, column]) => `${column} = ?`).join(", ");
    const values = entries.map(([key]) => input.patch[key] ?? null);
    const update = this.d1.prepare(
      `UPDATE vehicle SET ${setSql}, version = ?, updated_at = ? WHERE id = ? AND version = ?`,
    ).bind(...values, nextVersion, input.audit.occurredAt, input.id, input.expectedVersion);
    const batch: D1PreparedStatement[] = [update, auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "vehicle", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "vehicle", versionColumn: "version",
    })];
    if (Object.hasOwn(input.patch, "priceCents")) {
      batch.push(this.d1.prepare(
        `INSERT INTO vehicle_price_history
         (id, vehicle_id, price_cents, currency, valid_from, valid_until, changed_by, change_reason)
         SELECT ?, id, price_cents, currency, ?, price_valid_until, ?, 'ADMIN_UPDATE'
         FROM vehicle WHERE id = ? AND version = ? AND changes() > 0`,
      ).bind(crypto.randomUUID(), input.audit.occurredAt, input.actor.email, input.id, nextVersion));
    }
    const [result] = await this.d1.batch(batch);
    if (changes(result) === 0) return this.currentVehicleConflict(input.id, input.expectedVersion);
    const record = await this.findVehicleById(input.id);
    if (!record) return { ok: false, reason: "not_found" };
    return { ok: true, record };
  }

  archiveVehicle(input: { id: string } & CasContext): Promise<MutationResult<VehicleRow>> {
    return this.updateVehicle({ ...input, patch: { status: "ARCHIVED" } });
  }

  async listLeads(status?: string): Promise<AdminLeadContextRow[]> {
    const query = this.db
      .select({
        lead: leads,
        vehicleId: vehicles.id,
        vehicleSlug: vehicles.slug,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleTrim: vehicles.trim,
        vehicleYear: vehicles.year,
        simulationCode: simulations.publicCode,
      })
      .from(leads)
      .leftJoin(
        leadInterests,
        and(eq(leadInterests.leadId, leads.id), eq(leadInterests.kind, "SIMULATION")),
      )
      .leftJoin(simulations, eq(simulations.id, leadInterests.simulationId))
      .leftJoin(vehicles, eq(vehicles.id, simulations.vehicleId))
      .orderBy(desc(leads.updatedAt));
    const rows = status ? await query.where(eq(leads.status, status)) : await query;
    return rows.map((row) => ({
      ...row.lead,
      vehicleId: row.vehicleId,
      vehicleSlug: row.vehicleSlug,
      vehicleLabel: row.vehicleId
        ? [row.vehicleMake, row.vehicleModel, row.vehicleTrim, row.vehicleYear]
            .filter((value) => value !== null)
            .join(" ")
        : null,
      simulationCode: row.simulationCode,
    }));
  }

  async findLeadById(id: string): Promise<AdminLeadContextRow | null> {
    const rows = await this.db
      .select({
        lead: leads,
        vehicleId: vehicles.id,
        vehicleSlug: vehicles.slug,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleTrim: vehicles.trim,
        vehicleYear: vehicles.year,
        simulationCode: simulations.publicCode,
      })
      .from(leads)
      .leftJoin(
        leadInterests,
        and(eq(leadInterests.leadId, leads.id), eq(leadInterests.kind, "SIMULATION")),
      )
      .leftJoin(simulations, eq(simulations.id, leadInterests.simulationId))
      .leftJoin(vehicles, eq(vehicles.id, simulations.vehicleId))
      .where(eq(leads.id, id))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          ...row.lead,
          vehicleId: row.vehicleId,
          vehicleSlug: row.vehicleSlug,
          vehicleLabel: row.vehicleId
            ? [row.vehicleMake, row.vehicleModel, row.vehicleTrim, row.vehicleYear]
                .filter((value) => value !== null)
                .join(" ")
            : null,
          simulationCode: row.simulationCode,
        }
      : null;
  }

  async transitionLead(
    input: { id: string; nextStatus: string; assignedTo?: string | null; lostReason?: string | null } & CasContext,
  ): Promise<MutationResult<LeadRow>> {
    const nextVersion = input.expectedVersion + 1;
    const update = this.d1.prepare(
      `UPDATE lead SET status = ?, assigned_to = COALESCE(?, assigned_to), lost_reason = ?,
       version = ?, updated_at = ? WHERE id = ? AND version = ?`,
    ).bind(input.nextStatus, input.assignedTo ?? null, input.lostReason ?? null, nextVersion,
      input.audit.occurredAt, input.id, input.expectedVersion);
    const event = this.d1.prepare(
      `INSERT INTO lead_event
       (id, lead_id, type, actor_type, actor_id, metadata_json, occurred_at)
       SELECT ?, id, 'STATUS_CHANGED', 'USER', ?, ?, ? FROM lead
       WHERE id = ? AND version = ? AND changes() > 0`,
    ).bind(crypto.randomUUID(), input.actor.userId,
      JSON.stringify({ to: input.nextStatus, lostReason: input.lostReason ?? null }),
      input.audit.occurredAt, input.id, nextVersion);
    const audit = auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "lead", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "lead", versionColumn: "version",
    });
    const [result] = await this.d1.batch([update, audit, event]);
    if (changes(result) === 0) return this.currentConflict("lead", input.id, input.expectedVersion);
    const record = await this.findLeadById(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  listAppraisals(status?: string): Promise<AppraisalRow[]> {
    return status
      ? this.db.select().from(appraisals).where(eq(appraisals.status, status)).orderBy(desc(appraisals.updatedAt))
      : this.db.select().from(appraisals).orderBy(desc(appraisals.updatedAt));
  }

  async findAppraisalById(id: string): Promise<AppraisalRow | null> {
    const [row] = await this.db.select().from(appraisals).where(eq(appraisals.id, id)).limit(1);
    return row ?? null;
  }

  async reviewAppraisal(
    input: {
      id: string; nextStatus: string; lowCents?: number | null; baseCents?: number | null;
      highCents?: number | null; certaintyLevel?: string; validUntil?: string | null;
      reviewNotes?: string | null;
    } & CasContext,
  ): Promise<MutationResult<AppraisalRow>> {
    const nextVersion = input.expectedVersion + 1;
    const update = this.d1.prepare(
      `UPDATE appraisal SET status = ?, low_cents = COALESCE(?, low_cents),
       base_cents = COALESCE(?, base_cents), high_cents = COALESCE(?, high_cents),
       certainty_level = COALESCE(?, certainty_level), valid_until = COALESCE(?, valid_until),
       review_notes = COALESCE(?, review_notes), reviewed_by = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    ).bind(input.nextStatus, input.lowCents ?? null, input.baseCents ?? null,
      input.highCents ?? null, input.certaintyLevel ?? null, input.validUntil ?? null,
      input.reviewNotes ?? null, input.actor.email, nextVersion, input.audit.occurredAt,
      input.id, input.expectedVersion);
    const audit = auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "appraisal", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "appraisal", versionColumn: "version",
    });
    const [result] = await this.d1.batch([update, audit]);
    if (changes(result) === 0) return this.currentConflict("appraisal", input.id, input.expectedVersion);
    const record = await this.findAppraisalById(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  listConsignments(status?: string): Promise<ConsignmentRow[]> {
    return status
      ? this.db.select().from(consignments).where(eq(consignments.status, status)).orderBy(desc(consignments.updatedAt))
      : this.db.select().from(consignments).orderBy(desc(consignments.updatedAt));
  }

  async findConsignmentById(id: string): Promise<ConsignmentRow | null> {
    const [row] = await this.db.select().from(consignments).where(eq(consignments.id, id)).limit(1);
    return row ?? null;
  }

  async countReadyConsignmentMedia(id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(consignmentMedia)
      .where(and(eq(consignmentMedia.consignmentId, id), eq(consignmentMedia.status, "READY")));
    return Number(row?.total ?? 0);
  }

  async reviewConsignment(
    input: { id: string; nextStatus: string; reviewNotes?: string | null } & CasContext,
  ): Promise<MutationResult<ConsignmentRow>> {
    const nextVersion = input.expectedVersion + 1;
    const decided = input.nextStatus === "ACCEPTED" || input.nextStatus === "REJECTED";
    const update = this.d1.prepare(
      `UPDATE consignment SET status = ?, review_notes = COALESCE(?, review_notes),
       reviewed_by = ?, decided_at = CASE WHEN ? THEN ? ELSE decided_at END,
       version = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    ).bind(input.nextStatus, input.reviewNotes ?? null, input.actor.email,
      decided ? 1 : 0, input.audit.occurredAt, nextVersion, input.audit.occurredAt,
      input.id, input.expectedVersion);
    const audit = auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "consignment", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "consignment", versionColumn: "version",
    });
    const [result] = await this.d1.batch([update, audit]);
    if (changes(result) === 0) return this.currentConflict("consignment", input.id, input.expectedVersion);
    const record = await this.findConsignmentById(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  listFinanceVersions(status?: string): Promise<FinancePlanVersionRow[]> {
    return status
      ? this.db.select().from(financePlanVersions).where(eq(financePlanVersions.status, status)).orderBy(desc(financePlanVersions.updatedAt))
      : this.db.select().from(financePlanVersions).orderBy(desc(financePlanVersions.updatedAt));
  }

  async findFinanceVersion(id: string): Promise<(FinancePlanVersionRow & { tiers: FinancePlanTierRow[] }) | null> {
    const [row] = await this.db.select().from(financePlanVersions).where(eq(financePlanVersions.id, id)).limit(1);
    if (!row) return null;
    const tiers = await this.db.select().from(financePlanTiers)
      .where(eq(financePlanTiers.financePlanVersionId, id)).orderBy(financePlanTiers.sortOrder);
    return { ...row, tiers };
  }

  async createFinanceVersion(
    input: typeof financePlanVersions.$inferInsert,
    tiers: Array<typeof financePlanTiers.$inferInsert>,
    context: CreateContext,
  ): Promise<IdempotentCreateResult<FinancePlanVersionRow & { tiers: FinancePlanTierRow[] }>> {
    const replay = await this.findIdempotency("finance.create", context);
    if (replay) {
      if (replay.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
      const record = await this.findFinanceVersion(replay.resourceId);
      if (record) return { ok: true, record, replayed: true };
    }
    const now = context.audit.occurredAt;
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(
        `INSERT INTO admin_idempotency
         (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
         VALUES (?, 'finance.create', ?, ?, 'finance_plan_version', ?, ?)
         ON CONFLICT(scope, idempotency_key) DO NOTHING`,
      ).bind(crypto.randomUUID(), context.idempotencyKey, context.requestHash, input.id, context.actor.userId),
      this.d1.prepare(
        `INSERT INTO finance_plan_version
         (id, version, name, provider, status, currency, pricing_kind, monthly_rate_bps,
          installment_coefficient_ppm, max_finance_ratio_bps, minimum_down_payment_ratio_bps,
          allowed_vehicle_types_json, max_vehicle_age_years, requires_promotion_id,
          comfortable_payment_margin_bps, is_demo, disclaimer, valid_from, valid_until,
          published_at, lock_version, created_at, updated_at)
         SELECT ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?
         WHERE EXISTS (SELECT 1 FROM admin_idempotency WHERE scope = 'finance.create'
           AND idempotency_key = ? AND request_hash = ? AND resource_id = ?)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(input.id, input.version, input.name, input.provider, input.currency ?? "ARS",
        input.pricingKind, input.monthlyRateBps ?? null, input.installmentCoefficientPpm ?? null,
        input.maxFinanceRatioBps, input.minimumDownPaymentRatioBps,
        input.allowedVehicleTypesJson, input.maxVehicleAgeYears, input.requiresPromotionId ?? null,
        input.comfortablePaymentMarginBps ?? 1000, input.isDemo ? 1 : 0, input.disclaimer,
        input.validFrom, input.validUntil, now, now, context.idempotencyKey, context.requestHash, input.id),
      auditStatement(this.d1, {
        actor: context.actor, audit: context.audit, resourceType: "finance_plan_version", resourceId: input.id,
        previousVersion: null, nextVersion: 1, table: "finance_plan_version", versionColumn: "lock_version",
      }),
    ];
    for (const [index, tier] of tiers.entries()) {
      statements.push(this.d1.prepare(
        `INSERT INTO finance_plan_tier
         (id, finance_plan_version_id, term_months, min_amount_cents, max_amount_cents,
          installment_coefficient_ppm, sort_order)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM finance_plan_version WHERE id = ? AND lock_version = 1
         ) ON CONFLICT(id) DO NOTHING`,
      ).bind(tier.id, input.id, tier.termMonths, tier.minAmountCents, tier.maxAmountCents,
        tier.installmentCoefficientPpm ?? null, tier.sortOrder ?? index, input.id));
    }
    await this.d1.batch(statements);
    const winner = await this.findIdempotency("finance.create", context);
    if (!winner || winner.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
    const record = await this.findFinanceVersion(winner.resourceId);
    if (!record) throw new Error("ADMIN_FINANCE_CREATE_FAILED");
    return { ok: true, record, replayed: winner.resourceId !== input.id };
  }

  async setFinanceStatus(
    input: { id: string; nextStatus: "PUBLISHED" | "RETIRED" } & CasContext,
  ): Promise<MutationResult<FinancePlanVersionRow>> {
    const nextVersion = input.expectedVersion + 1;
    const update = this.d1.prepare(
      `UPDATE finance_plan_version SET status = ?, published_at = CASE WHEN ? = 'PUBLISHED' THEN ? ELSE published_at END,
       lock_version = ?, updated_at = ? WHERE id = ? AND lock_version = ?`,
    ).bind(input.nextStatus, input.nextStatus, input.audit.occurredAt, nextVersion,
      input.audit.occurredAt, input.id, input.expectedVersion);
    const audit = auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "finance_plan_version", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "finance_plan_version", versionColumn: "lock_version",
    });
    const [result] = await this.d1.batch([update, audit]);
    if (changes(result) === 0) return this.currentConflict("finance_plan_version", input.id, input.expectedVersion, "lock_version");
    const record = await this.findFinanceVersion(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  listPromotions(status?: string): Promise<PromotionRow[]> {
    return status
      ? this.db.select().from(promotions).where(eq(promotions.status, status)).orderBy(desc(promotions.updatedAt))
      : this.db.select().from(promotions).orderBy(desc(promotions.updatedAt));
  }

  async findPromotionById(id: string): Promise<(PromotionRow & { vehicleIds: string[] }) | null> {
    const [row] = await this.db.select().from(promotions).where(eq(promotions.id, id)).limit(1);
    if (!row) return null;
    const links = await this.db.select({ vehicleId: promotionVehicles.vehicleId })
      .from(promotionVehicles).where(eq(promotionVehicles.promotionId, id));
    return { ...row, vehicleIds: links.map((item) => item.vehicleId) };
  }

  async createPromotion(
    input: typeof promotions.$inferInsert,
    vehicleIds: string[],
    context: CreateContext,
  ): Promise<IdempotentCreateResult<PromotionRow & { vehicleIds: string[] }>> {
    const replay = await this.findIdempotency("promotion.create", context);
    if (replay) {
      if (replay.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
      const record = await this.findPromotionById(replay.resourceId);
      if (record) return { ok: true, record, replayed: true };
    }
    const now = context.audit.occurredAt;
    const statements: D1PreparedStatement[] = [
      this.d1.prepare(
        `INSERT INTO admin_idempotency
         (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
         VALUES (?, 'promotion.create', ?, ?, 'promotion', ?, ?)
         ON CONFLICT(scope, idempotency_key) DO NOTHING`,
      ).bind(crypto.randomUUID(), context.idempotencyKey, context.requestHash, input.id, context.actor.userId),
      this.d1.prepare(
        `INSERT INTO promotion
         (id, slug, public_code, title, description, type, status, discount_cents,
          trade_in_bonus_cents, finance_plan_version_id, stackable,
          normal_conditions_snapshot_json, starts_at, ends_at, published_at,
          version, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?
         WHERE EXISTS (SELECT 1 FROM admin_idempotency WHERE scope = 'promotion.create'
           AND idempotency_key = ? AND request_hash = ? AND resource_id = ?)
         ON CONFLICT(id) DO NOTHING`,
      ).bind(input.id, input.slug, input.publicCode, input.title, input.description, input.type,
        input.discountCents ?? 0, input.tradeInBonusCents ?? 0, input.financePlanVersionId ?? null,
        input.stackable ? 1 : 0, input.normalConditionsSnapshotJson, input.startsAt, input.endsAt,
        now, now, context.idempotencyKey, context.requestHash, input.id),
      auditStatement(this.d1, {
        actor: context.actor, audit: context.audit, resourceType: "promotion", resourceId: input.id,
        previousVersion: null, nextVersion: 1, table: "promotion", versionColumn: "version",
      }),
    ];
    for (const [index, vehicleId] of vehicleIds.entries()) {
      statements.push(this.d1.prepare(
        `INSERT INTO promotion_vehicle (promotion_id, vehicle_id, is_primary)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM promotion WHERE id = ? AND version = 1)
         ON CONFLICT(promotion_id, vehicle_id) DO NOTHING`,
      ).bind(input.id, vehicleId, index === 0 ? 1 : 0, input.id));
    }
    await this.d1.batch(statements);
    const winner = await this.findIdempotency("promotion.create", context);
    if (!winner || winner.requestHash !== context.requestHash) return { ok: false, reason: "idempotency_conflict" };
    const record = await this.findPromotionById(winner.resourceId);
    if (!record) throw new Error("ADMIN_PROMOTION_CREATE_FAILED");
    return { ok: true, record, replayed: winner.resourceId !== input.id };
  }

  async setPromotionStatus(
    input: { id: string; nextStatus: string; startsAt?: string; endsAt?: string } & CasContext,
  ): Promise<MutationResult<PromotionRow & { vehicleIds: string[] }>> {
    const nextVersion = input.expectedVersion + 1;
    const update = this.d1.prepare(
      `UPDATE promotion SET status = ?, starts_at = COALESCE(?, starts_at),
       ends_at = COALESCE(?, ends_at), published_at = CASE WHEN ? = 'ACTIVE' THEN ? ELSE published_at END,
       version = ?, updated_at = ? WHERE id = ? AND version = ?`,
    ).bind(input.nextStatus, input.startsAt ?? null, input.endsAt ?? null, input.nextStatus,
      input.audit.occurredAt, nextVersion, input.audit.occurredAt, input.id, input.expectedVersion);
    const audit = auditStatement(this.d1, {
      actor: input.actor, audit: input.audit, resourceType: "promotion", resourceId: input.id,
      previousVersion: input.expectedVersion, nextVersion, table: "promotion", versionColumn: "version",
    });
    const [result] = await this.d1.batch([update, audit]);
    if (changes(result) === 0) return this.currentConflict("promotion", input.id, input.expectedVersion);
    const record = await this.findPromotionById(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  private async findIdempotency(scope: string, context: CreateContext) {
    const [row] = await this.db.select().from(adminIdempotency).where(and(
      eq(adminIdempotency.scope, scope),
      eq(adminIdempotency.idempotencyKey, context.idempotencyKey),
    )).limit(1);
    return row ?? null;
  }

  private currentVehicleConflict(id: string, expectedVersion: number): Promise<MutationResult<VehicleRow>> {
    return this.currentConflict("vehicle", id, expectedVersion) as Promise<MutationResult<VehicleRow>>;
  }

  private async currentConflict(
    table: "vehicle" | "lead" | "appraisal" | "consignment" | "finance_plan_version" | "promotion",
    id: string,
    expectedVersion: number,
    versionColumn: "version" | "lock_version" = "version",
  ): Promise<MutationResult<never>> {
    const row = await this.d1.prepare(
      `SELECT ${versionColumn} AS currentVersion FROM ${table} WHERE id = ?`,
    ).bind(id).first<{ currentVersion: number }>();
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "conflict", currentVersion: Number(row.currentVersion ?? expectedVersion) };
  }
}

export function createAdminRepository(): D1AdminRepository {
  return new D1AdminRepository();
}
