import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
  appraisals,
  businessProfiles,
  financePlanTiers,
  financePlanVersions,
  leadEvents,
  leads,
  promotionVehicles,
  promotions,
  simulations,
  vehicleMedia,
  vehicles,
  type AppraisalRow,
  type BusinessProfileRow,
  type FinancePlanTierRow,
  type LeadRow,
  type PromotionRow,
  type SimulationRow,
  type VehicleMediaRow,
  type VehicleRow,
} from "@/db/schema";

export type StockVehicle = VehicleRow & { media: VehicleMediaRow[] };
export type CurrentPromotion = PromotionRow & { vehicleIds: string[] };

export interface StockRepository {
  listAvailable(): Promise<StockVehicle[]>;
  findBySlug(slug: string): Promise<StockVehicle | null>;
}

export interface BusinessProfileRepository {
  get(): Promise<BusinessProfileRow | null>;
}

export interface LeadRepository {
  findById(id: string): Promise<LeadRow | null>;
  listByStatus(status?: string): Promise<LeadRow[]>;
  create(input: typeof leads.$inferInsert): Promise<LeadRow>;
  transition(input: {
    leadId: string;
    expectedVersion: number;
    nextStatus: string;
    actorId?: string;
    reason?: string;
  }): Promise<boolean>;
}

export interface AppraisalRepository {
  findByPublicCode(publicCode: string): Promise<AppraisalRow | null>;
  create(input: typeof appraisals.$inferInsert): Promise<AppraisalRow>;
}

export interface SimulationRepository {
  findByPublicCode(publicCode: string): Promise<SimulationRow | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<SimulationRow | null>;
  create(input: typeof simulations.$inferInsert): Promise<SimulationRow>;
}

export type SimulationReplaySelection = Readonly<{
  vehicleId: string | null;
  appraisalId: string | null;
  leadId: string | null;
}>;

export type SimulationReplayFingerprint = Readonly<{
  selection: SimulationReplaySelection;
  canonicalInput: unknown;
}>;

export class SimulationReplayConflict extends Error {
  readonly code = "OPERATION_CHANGED";

  constructor() {
    super("La clave de idempotencia ya fue usada para otra selección u operación.");
    this.name = "SimulationReplayConflict";
  }
}

export function simulationReplayFingerprint(
  row: Pick<
    SimulationRow,
    "vehicleId" | "appraisalId" | "leadId" | "inputSnapshotJson"
  >,
): SimulationReplayFingerprint {
  return Object.freeze({
    selection: Object.freeze({
      vehicleId: row.vehicleId,
      appraisalId: row.appraisalId,
      leadId: row.leadId,
    }),
    canonicalInput: canonicalSimulationInput(row.inputSnapshotJson),
  });
}

export function assertSimulationReplay(
  existing: SimulationRow,
  expected: SimulationReplayFingerprint,
): SimulationRow {
  const stored = simulationReplayFingerprint(existing);
  if (
    stored.selection.vehicleId !== expected.selection.vehicleId ||
    stored.selection.appraisalId !== expected.selection.appraisalId ||
    stored.selection.leadId !== expected.selection.leadId ||
    stableJson(stored.canonicalInput) !==
      stableJson(canonicalSimulationInput(expected.canonicalInput))
  ) {
    throw new SimulationReplayConflict();
  }
  return existing;
}

export function canonicalSimulationInput(snapshot: string | unknown): unknown {
  let value: unknown = snapshot;
  if (typeof snapshot === "string") {
    try {
      value = JSON.parse(snapshot) as unknown;
    } catch {
      throw new Error("SIMULATION_INPUT_SNAPSHOT_INVALID");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SIMULATION_INPUT_SNAPSHOT_INVALID");
  }
  return sortJson(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([key]) => key !== "at" && key !== "evaluatedAt",
      ),
    ),
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export interface PromotionRepository {
  findCurrent(now?: Date): Promise<CurrentPromotion | null>;
}

export type FinancePlanRecord = {
  id: string;
  version: string;
  name: string;
  enabled: boolean;
  validFrom: string;
  validUntil: string;
  allowedTerms: number[];
  minAmountCents: number;
  maxAmountCents: number;
  maxFinanceRatioBps: number;
  minimumDownPaymentRatioBps: number;
  allowedVehicleTypes: string[];
  maxVehicleAgeYears: number;
  requiresPromotionId: string | null;
  comfortablePaymentMarginBps: number;
  isDemo: boolean;
  disclaimer: string;
  pricing:
    | { kind: "french"; monthlyRateBps: number }
    | { kind: "coefficient"; installmentCoefficientPpm: number }
    | {
        kind: "table";
        rows: Array<{
          termMonths: number;
          fromAmountCents: number;
          toAmountCents: number;
          installmentCoefficientPpm: number;
        }>;
      };
};

export interface FinancePlanRepository {
  listCurrent(now?: Date): Promise<FinancePlanRecord[]>;
}

export type OfferRepository = PromotionRepository;

function groupMedia(rows: VehicleMediaRow[]): Map<string, VehicleMediaRow[]> {
  const grouped = new Map<string, VehicleMediaRow[]>();
  for (const item of rows) {
    const current = grouped.get(item.vehicleId) ?? [];
    current.push(item);
    grouped.set(item.vehicleId, current);
  }
  return grouped;
}

async function attachMedia(db: Database, rows: VehicleRow[]): Promise<StockVehicle[]> {
  if (rows.length === 0) return [];
  const media = await db
    .select()
    .from(vehicleMedia)
    .where(
      and(
        inArray(vehicleMedia.vehicleId, rows.map((row) => row.id)),
        eq(vehicleMedia.status, "READY"),
      ),
    )
    .orderBy(asc(vehicleMedia.sortOrder));
  const grouped = groupMedia(media);
  return rows.map((row) => ({ ...row, media: grouped.get(row.id) ?? [] }));
}

export class D1StockRepository implements StockRepository {
  constructor(private readonly db: Database = getDb()) {}

  async listAvailable(): Promise<StockVehicle[]> {
    const rows = await this.db
      .select()
      .from(vehicles)
      .where(eq(vehicles.status, "AVAILABLE"))
      .orderBy(desc(vehicles.updatedAt));
    return attachMedia(this.db, rows);
  }

  async findBySlug(slug: string): Promise<StockVehicle | null> {
    const [row] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.slug, slug), eq(vehicles.status, "AVAILABLE")))
      .limit(1);
    if (!row) return null;
    const [result] = await attachMedia(this.db, [row]);
    return result;
  }
}

export class D1BusinessProfileRepository implements BusinessProfileRepository {
  constructor(private readonly db: Database = getDb()) {}

  async get(): Promise<BusinessProfileRow | null> {
    const [profile] = await this.db.select().from(businessProfiles).limit(1);
    return profile ?? null;
  }
}

export class D1LeadRepository implements LeadRepository {
  constructor(private readonly db: Database = getDb()) {}

  async findById(id: string): Promise<LeadRow | null> {
    const [lead] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return lead ?? null;
  }

  listByStatus(status?: string): Promise<LeadRow[]> {
    return status
      ? this.db.select().from(leads).where(eq(leads.status, status)).orderBy(desc(leads.updatedAt))
      : this.db.select().from(leads).orderBy(desc(leads.updatedAt));
  }

  async create(input: typeof leads.$inferInsert): Promise<LeadRow> {
    await this.db.insert(leads).values(input).onConflictDoNothing();
    if (input.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(leads)
        .where(eq(leads.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return existing;
    }
    const created = await this.findById(input.id);
    if (!created) throw new Error("LEAD_CREATE_FAILED");
    return created;
  }

  async transition(input: {
    leadId: string;
    expectedVersion: number;
    nextStatus: string;
    actorId?: string;
    reason?: string;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const updated = await this.db
      .update(leads)
      .set({ status: input.nextStatus, version: input.expectedVersion + 1, updatedAt: now })
      .where(and(eq(leads.id, input.leadId), eq(leads.version, input.expectedVersion)))
      .returning({ id: leads.id });
    if (updated.length === 0) return false;

    await this.db.insert(leadEvents).values({
      id: crypto.randomUUID(),
      leadId: input.leadId,
      type: "STATUS_CHANGED",
      actorType: input.actorId ? "USER" : "SYSTEM",
      actorId: input.actorId,
      metadataJson: JSON.stringify({ to: input.nextStatus, reason: input.reason ?? null }),
      occurredAt: now,
    });
    return true;
  }
}

export class D1AppraisalRepository implements AppraisalRepository {
  constructor(private readonly db: Database = getDb()) {}

  async findByPublicCode(publicCode: string): Promise<AppraisalRow | null> {
    const [row] = await this.db
      .select()
      .from(appraisals)
      .where(eq(appraisals.publicCode, publicCode))
      .limit(1);
    return row ?? null;
  }

  async create(input: typeof appraisals.$inferInsert): Promise<AppraisalRow> {
    await this.db.insert(appraisals).values(input).onConflictDoNothing();
    const [row] = input.idempotencyKey
      ? await this.db
          .select()
          .from(appraisals)
          .where(eq(appraisals.idempotencyKey, input.idempotencyKey))
          .limit(1)
      : await this.db.select().from(appraisals).where(eq(appraisals.id, input.id)).limit(1);
    if (!row) throw new Error("APPRAISAL_CREATE_FAILED");
    return row;
  }
}

export class D1SimulationRepository implements SimulationRepository {
  constructor(private readonly db: Database = getDb()) {}

  async findByPublicCode(publicCode: string): Promise<SimulationRow | null> {
    const [row] = await this.db
      .select()
      .from(simulations)
      .where(eq(simulations.publicCode, publicCode))
      .limit(1);
    return row ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SimulationRow | null> {
    const [row] = await this.db
      .select()
      .from(simulations)
      .where(eq(simulations.idempotencyKey, idempotencyKey))
      .limit(1);
    return row ?? null;
  }

  async create(input: typeof simulations.$inferInsert): Promise<SimulationRow> {
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return assertSimulationReplay(existing, {
          selection: {
            vehicleId: input.vehicleId ?? null,
            appraisalId: input.appraisalId ?? null,
            leadId: input.leadId ?? null,
          },
          canonicalInput: canonicalSimulationInput(input.inputSnapshotJson),
        });
      }
    }
    await this.db.insert(simulations).values(input).onConflictDoNothing();
    const [row] = input.idempotencyKey
      ? [await this.findByIdempotencyKey(input.idempotencyKey)]
      : await this.db.select().from(simulations).where(eq(simulations.id, input.id)).limit(1);
    if (!row) throw new Error("SIMULATION_CREATE_FAILED");
    if (input.idempotencyKey && row.id !== input.id) {
      return assertSimulationReplay(row, {
        selection: {
          vehicleId: input.vehicleId ?? null,
          appraisalId: input.appraisalId ?? null,
          leadId: input.leadId ?? null,
        },
        canonicalInput: canonicalSimulationInput(input.inputSnapshotJson),
      });
    }
    return row;
  }
}

export class D1PromotionRepository implements PromotionRepository {
  constructor(private readonly db: Database = getDb()) {}

  async findCurrent(now = new Date()): Promise<CurrentPromotion | null> {
    const instant = now.toISOString();
    const [promotion] = await this.db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.status, "ACTIVE"),
          lte(promotions.startsAt, instant),
          gt(promotions.endsAt, instant),
        ),
      )
      .orderBy(desc(promotions.startsAt))
      .limit(1);
    if (!promotion) return null;
    const links = await this.db
      .select({ vehicleId: promotionVehicles.vehicleId })
      .from(promotionVehicles)
      .where(eq(promotionVehicles.promotionId, promotion.id));
    return { ...promotion, vehicleIds: links.map((link) => link.vehicleId) };
  }
}

function allowedVehicleTypes(value: string, planId: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`FINANCE_PLAN_INVALID_VEHICLE_TYPES:${planId}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`FINANCE_PLAN_INVALID_VEHICLE_TYPES:${planId}`);
  }
  return [...new Set(parsed)];
}

function pricingForPlan(
  plan: typeof financePlanVersions.$inferSelect,
  tiers: FinancePlanTierRow[],
): FinancePlanRecord["pricing"] {
  if (plan.pricingKind === "french" && plan.monthlyRateBps !== null) {
    return { kind: "french", monthlyRateBps: plan.monthlyRateBps };
  }
  if (plan.pricingKind === "coefficient" && plan.installmentCoefficientPpm !== null) {
    return {
      kind: "coefficient",
      installmentCoefficientPpm: plan.installmentCoefficientPpm,
    };
  }
  if (plan.pricingKind === "table") {
    const rows = tiers.map((tier) => {
      if (tier.installmentCoefficientPpm === null) {
        throw new Error(`FINANCE_PLAN_INVALID_TABLE:${plan.id}`);
      }
      return {
        termMonths: tier.termMonths,
        fromAmountCents: tier.minAmountCents,
        toAmountCents: tier.maxAmountCents,
        installmentCoefficientPpm: tier.installmentCoefficientPpm,
      };
    });
    return { kind: "table", rows };
  }
  throw new Error(`FINANCE_PLAN_INVALID_PRICING:${plan.id}`);
}

export class D1FinancePlanRepository implements FinancePlanRepository {
  constructor(private readonly db: Database = getDb()) {}

  async listCurrent(now = new Date()): Promise<FinancePlanRecord[]> {
    const instant = now.toISOString();
    const plans = await this.db
      .select()
      .from(financePlanVersions)
      .where(
        and(
          eq(financePlanVersions.status, "PUBLISHED"),
          lte(financePlanVersions.validFrom, instant),
          gt(financePlanVersions.validUntil, instant),
        ),
      )
      .orderBy(asc(financePlanVersions.name));
    if (plans.length === 0) return [];
    const tiers = await this.db
      .select()
      .from(financePlanTiers)
      .where(inArray(financePlanTiers.financePlanVersionId, plans.map((plan) => plan.id)))
      .orderBy(asc(financePlanTiers.sortOrder), asc(financePlanTiers.termMonths));

    return plans.map((plan) => {
      const planTiers = tiers.filter((tier) => tier.financePlanVersionId === plan.id);
      if (planTiers.length === 0) throw new Error(`FINANCE_PLAN_MISSING_TIERS:${plan.id}`);
      return {
        id: plan.id,
        version: plan.version,
        name: plan.name,
        enabled: true,
        validFrom: plan.validFrom,
        validUntil: plan.validUntil,
        allowedTerms: [...new Set(planTiers.map((tier) => tier.termMonths))],
        minAmountCents: Math.min(...planTiers.map((tier) => tier.minAmountCents)),
        maxAmountCents: Math.max(...planTiers.map((tier) => tier.maxAmountCents)),
        maxFinanceRatioBps: plan.maxFinanceRatioBps,
        minimumDownPaymentRatioBps: plan.minimumDownPaymentRatioBps,
        allowedVehicleTypes: allowedVehicleTypes(plan.allowedVehicleTypesJson, plan.id),
        maxVehicleAgeYears: plan.maxVehicleAgeYears,
        requiresPromotionId: plan.requiresPromotionId,
        comfortablePaymentMarginBps: plan.comfortablePaymentMarginBps,
        isDemo: plan.isDemo,
        disclaimer: plan.disclaimer,
        pricing: pricingForPlan(plan, planTiers),
      };
    });
  }
}

export { D1PromotionRepository as D1OfferRepository };

export function createRepositories(db: Database = getDb()) {
  const promotionsRepository = new D1PromotionRepository(db);
  return {
    stock: new D1StockRepository(db),
    businessProfile: new D1BusinessProfileRepository(db),
    leads: new D1LeadRepository(db),
    appraisals: new D1AppraisalRepository(db),
    simulations: new D1SimulationRepository(db),
    promotions: promotionsRepository,
    offers: promotionsRepository,
    financingPlans: new D1FinancePlanRepository(db),
  };
}
