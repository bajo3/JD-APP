import { getDb } from "@/db";
import {
  appraisals,
  consents,
  leadEvents,
  leads,
  simulations,
  type AppraisalRow,
  type BusinessProfileRow,
  type LeadRow,
  type PromotionRow,
  type SimulationRow,
  type VehicleRow,
} from "@/db/schema";
import {
  businessProfileFixture,
  createAppraisalFixture,
  createPromotionFixture,
  createSimulationFixture,
  leadFixture,
  stockFixtures,
} from "@/lib/data/fixtures";
import {
  assertSimulationReplay,
  canonicalSimulationInput,
  createRepositories,
  type AppraisalRepository,
  type BusinessProfileRepository,
  type CurrentPromotion,
  type FinancePlanRepository,
  type LeadRepository,
  type PromotionRepository,
  type SimulationRepository,
  type StockRepository,
  type StockVehicle,
} from "@/lib/data/repositories";
import { ApiError } from "./api";
import { canUseDevelopmentFixtures, isMissingD1BindingError } from "./runtime-policy";

export type DataSource = "d1" | "fixture";

export interface DataAccess {
  source: DataSource;
  stock: StockRepository;
  businessProfile: BusinessProfileRepository;
  leads: LeadRepository;
  appraisals: AppraisalRepository;
  simulations: SimulationRepository;
  promotions: PromotionRepository;
  financingPlans?: FinancePlanRepository;
  recordConsent(input: {
    id: string;
    leadId: string;
    channel: string;
    purpose: string;
    grantedAt: string;
    evidence: Record<string, unknown>;
  }): Promise<void>;
  recordLeadEvent(input: {
    id: string;
    leadId: string;
    type: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }): Promise<boolean>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function vehicleRow(input: typeof stockFixtures[number]): VehicleRow {
  const now = nowIso();
  return {
    ...input,
    externalCode: input.externalCode ?? null,
    currency: input.currency ?? "ARS",
    priceValidUntil: input.priceValidUntil ?? null,
    status: input.status ?? "AVAILABLE",
    source: input.source ?? "fixture",
    lastSyncedAt: input.lastSyncedAt ?? now,
    publishedAt: input.publishedAt ?? now,
    internalNotes: input.internalNotes ?? null,
    version: input.version ?? 1,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function businessRow(): BusinessProfileRow {
  const now = nowIso();
  return {
    ...businessProfileFixture,
    whatsappE164: businessProfileFixture.whatsappE164 ?? null,
    mapUrl: businessProfileFixture.mapUrl ?? null,
    hoursJson: businessProfileFixture.hoursJson ?? null,
    socialLinksJson: businessProfileFixture.socialLinksJson ?? null,
    stockFreshnessMinutes: businessProfileFixture.stockFreshnessMinutes ?? 1440,
    version: businessProfileFixture.version ?? 1,
    createdAt: businessProfileFixture.createdAt ?? now,
    updatedAt: businessProfileFixture.updatedAt ?? now,
  };
}

function leadRow(input: typeof leads.$inferInsert): LeadRow {
  const now = nowIso();
  return {
    idempotencyKey: null,
    email: null,
    status: "NEW",
    score: 0,
    assignedTo: null,
    lostReason: null,
    lastContactedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function appraisalRow(input: typeof appraisals.$inferInsert): AppraisalRow {
  const now = nowIso();
  return {
    idempotencyKey: null,
    leadId: null,
    trim: null,
    documentationStatus: null,
    hasLien: false,
    repairNotes: null,
    status: "SUBMITTED",
    certaintyLevel: "T0",
    lowCents: null,
    baseCents: null,
    highCents: null,
    currency: "ARS",
    ruleSetId: null,
    reviewedBy: null,
    reviewNotes: null,
    validUntil: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function simulationRow(input: typeof simulations.$inferInsert): SimulationRow {
  return {
    idempotencyKey: null,
    leadId: null,
    vehicleId: null,
    appraisalId: null,
    promotionId: null,
    status: "ACTIVE",
    appraisalAppliedCents: 0,
    tradeInBonusCents: 0,
    cashCents: 0,
    financePrincipalCents: 0,
    termMonths: null,
    installmentCents: null,
    totalCostCents: null,
    currency: "ARS",
    financePlanVersion: null,
    createdAt: nowIso(),
    ...input,
  };
}

function promotionRow(now = new Date()): CurrentPromotion {
  const input = createPromotionFixture(now);
  const timestamp = now.toISOString();
  const row: PromotionRow = {
    ...input,
    status: input.status ?? "ACTIVE",
    discountCents: input.discountCents ?? 0,
    tradeInBonusCents: input.tradeInBonusCents ?? 0,
    financePlanVersionId: input.financePlanVersionId ?? null,
    stackable: input.stackable ?? false,
    publishedAt: input.publishedAt ?? null,
    version: input.version ?? 1,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
  return { ...row, vehicleIds: ["veh-tcross-2022"] };
}

class DevelopmentStore {
  readonly vehicles = stockFixtures.map(vehicleRow);
  readonly profile = businessRow();
  readonly leadRows = new Map<string, LeadRow>([
    [leadFixture.id, leadRow(leadFixture)],
  ]);
  readonly appraisalRows = new Map<string, AppraisalRow>();
  readonly simulationRows = new Map<string, SimulationRow>();
  readonly consentIds = new Set<string>();
  readonly eventIds = new Set<string>();

  constructor() {
    const appraisal = appraisalRow(createAppraisalFixture());
    const simulation = simulationRow(createSimulationFixture());
    this.appraisalRows.set(appraisal.id, appraisal);
    this.simulationRows.set(simulation.id, simulation);
  }
}

const developmentStore = new DevelopmentStore();

function findByIdempotency<T extends { idempotencyKey: string | null }>(
  values: Iterable<T>,
  key: string | null | undefined,
): T | undefined {
  return key ? Array.from(values).find((value) => value.idempotencyKey === key) : undefined;
}

function developmentAccess(): DataAccess {
  const stock: StockRepository = {
    async listAvailable() {
      return developmentStore.vehicles
        .filter((vehicle) => vehicle.status === "AVAILABLE")
        .map((vehicle): StockVehicle => ({ ...vehicle, media: [] }));
    },
    async findBySlug(slug) {
      const vehicle = developmentStore.vehicles.find(
        (item) => item.slug === slug && item.status === "AVAILABLE",
      );
      return vehicle ? { ...vehicle, media: [] } : null;
    },
  };

  const businessProfile: BusinessProfileRepository = {
    async get() {
      return developmentStore.profile;
    },
  };

  const leadRepository: LeadRepository = {
    async findById(id) {
      return developmentStore.leadRows.get(id) ?? null;
    },
    async listByStatus(status) {
      return Array.from(developmentStore.leadRows.values()).filter(
        (lead) => !status || lead.status === status,
      );
    },
    async create(input) {
      const replay = findByIdempotency(developmentStore.leadRows.values(), input.idempotencyKey);
      if (replay) return replay;
      const row = leadRow(input);
      developmentStore.leadRows.set(row.id, row);
      return row;
    },
    async transition(input) {
      const current = developmentStore.leadRows.get(input.leadId);
      if (!current || current.version !== input.expectedVersion) return false;
      developmentStore.leadRows.set(input.leadId, {
        ...current,
        status: input.nextStatus,
        version: current.version + 1,
        updatedAt: nowIso(),
      });
      return true;
    },
  };

  const appraisalRepository: AppraisalRepository = {
    async findByPublicCode(publicCode) {
      return (
        Array.from(developmentStore.appraisalRows.values()).find(
          (item) => item.publicCode === publicCode,
        ) ?? null
      );
    },
    async create(input) {
      const replay = findByIdempotency(
        developmentStore.appraisalRows.values(),
        input.idempotencyKey,
      );
      if (replay) return replay;
      const row = appraisalRow(input);
      developmentStore.appraisalRows.set(row.id, row);
      return row;
    },
  };

  const simulationRepository: SimulationRepository = {
    async findByPublicCode(publicCode) {
      return (
        Array.from(developmentStore.simulationRows.values()).find(
          (item) => item.publicCode === publicCode,
        ) ?? null
      );
    },
    async findByIdempotencyKey(idempotencyKey) {
      return (
        findByIdempotency(
          developmentStore.simulationRows.values(),
          idempotencyKey,
        ) ?? null
      );
    },
    async create(input) {
      const replay = findByIdempotency(
        developmentStore.simulationRows.values(),
        input.idempotencyKey,
      );
      if (replay) {
        return assertSimulationReplay(replay, {
          selection: {
            vehicleId: input.vehicleId ?? null,
            appraisalId: input.appraisalId ?? null,
            leadId: input.leadId ?? null,
          },
          canonicalInput: canonicalSimulationInput(input.inputSnapshotJson),
        });
      }
      const row = simulationRow(input);
      developmentStore.simulationRows.set(row.id, row);
      return row;
    },
  };

  const promotionRepository: PromotionRepository = {
    async findCurrent(now) {
      return promotionRow(now);
    },
  };

  return {
    source: "fixture",
    stock,
    businessProfile,
    leads: leadRepository,
    appraisals: appraisalRepository,
    simulations: simulationRepository,
    promotions: promotionRepository,
    async recordConsent(input) {
      developmentStore.consentIds.add(input.id);
    },
    async recordLeadEvent(input) {
      const created = !developmentStore.eventIds.has(input.id);
      developmentStore.eventIds.add(input.id);
      return created;
    },
  };
}

export function getDataAccess(): DataAccess {
  try {
    const db = getDb();
    const repositories = createRepositories(db);
    return {
      source: "d1",
      ...repositories,
      async recordConsent(input) {
        await db
          .insert(consents)
          .values({
            id: input.id,
            leadId: input.leadId,
            channel: input.channel,
            purpose: input.purpose,
            grantedAt: input.grantedAt,
            evidenceJson: JSON.stringify(input.evidence),
          })
          .onConflictDoNothing();
      },
      async recordLeadEvent(input) {
        const inserted = await db
          .insert(leadEvents)
          .values({
            id: input.id,
            leadId: input.leadId,
            type: input.type,
            actorType: "CUSTOMER",
            metadataJson: JSON.stringify(input.metadata),
            occurredAt: input.occurredAt,
          })
          .onConflictDoNothing()
          .returning({ id: leadEvents.id });
        return inserted.length > 0;
      },
    };
  } catch (error) {
    if (canUseDevelopmentFixtures(error, process.env.NODE_ENV)) {
      return developmentAccess();
    }
    if (isMissingD1BindingError(error)) {
      throw new ApiError(
        503,
        "PERSISTENCE_UNAVAILABLE",
        "La persistencia no está disponible temporalmente.",
      );
    }
    throw error;
  }
}

export function sourceMeta(source: DataSource): { source: DataSource; demo: boolean } {
  return { source, demo: source === "fixture" };
}
