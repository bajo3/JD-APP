import type {
  AdminAppraisalRecord,
  AdminAuditCommand,
  AdminLeadRecord,
  AdminOverviewRecord,
  AdminPromotionRecord,
  AdminRepositories,
  AdminVehicleRecord,
  FinanceVersionRecord,
  MutationResult,
} from "@/lib/admin";
import {
  D1AdminRepository,
  type AdminLeadContextRow,
  type AdminActor,
  type AdminAudit,
  type MutationResult as DataMutationResult,
} from "@/lib/data/admin-repositories";
import type {
  AppraisalRow,
  FinancePlanTierRow,
  FinancePlanVersionRow,
  LeadRow,
  PromotionRow,
  VehicleRow,
} from "@/db/schema";

function audit(command: AdminAuditCommand): AdminAudit {
  return {
    action: command.action,
    occurredAt: command.occurredAt,
    metadata: command.summary,
  };
}

function dataResult<TSource, TTarget>(
  result: DataMutationResult<TSource>,
  map: (value: TSource) => TTarget,
): MutationResult<TTarget> {
  if (!result.ok) return result;
  return { ok: true, record: map(result.record), ...(result.replayed ? { replayed: true } : {}) };
}

function vehicleRecord(row: VehicleRow): AdminVehicleRecord {
  return {
    ...row,
    currency: "ARS",
    status: row.status as AdminVehicleRecord["status"],
    isDemo: row.source.toUpperCase().includes("DEMO"),
  };
}

function maskPhone(value: string): string {
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

function leadRecord(row: LeadRow | AdminLeadContextRow): AdminLeadRecord {
  const contextual = "simulationCode" in row ? row : null;
  return {
    id: row.id,
    name: row.name,
    phoneMasked: maskPhone(row.phoneNormalized),
    status: row.status as AdminLeadRecord["status"],
    assignedTo: row.assignedTo,
    lostReason: row.lostReason,
    source: row.source,
    vehicleId: contextual?.vehicleId ?? null,
    vehicleSlug: contextual?.vehicleSlug ?? null,
    vehicleLabel: contextual?.vehicleLabel ?? null,
    simulationCode: contextual?.simulationCode ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDemo: row.source.toUpperCase().includes("DEMO"),
  };
}

function appraisalRecord(row: AppraisalRow): AdminAppraisalRecord {
  return {
    id: row.id,
    leadId: row.leadId,
    vehicleDescription: [row.make, row.model, row.trim, row.year].filter(Boolean).join(" "),
    status: row.status as AdminAppraisalRecord["status"],
    lowCents: row.lowCents,
    baseCents: row.baseCents,
    highCents: row.highCents,
    currency: "ARS",
    certaintyLevel: row.certaintyLevel as AdminAppraisalRecord["certaintyLevel"],
    validUntil: row.validUntil,
    notes: row.reviewNotes,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDemo: row.publicCode.toUpperCase().includes("DEMO"),
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function financeRecord(
  row: FinancePlanVersionRow & { tiers: FinancePlanTierRow[] },
): FinanceVersionRecord {
  return {
    ...row,
    currency: "ARS",
    status: row.status as FinanceVersionRecord["status"],
    pricingKind: row.pricingKind as FinanceVersionRecord["pricingKind"],
    allowedVehicleTypes: parseStringArray(row.allowedVehicleTypesJson),
    tiers: row.tiers.map((tier) => ({
      id: tier.id,
      termMonths: tier.termMonths,
      minAmountCents: tier.minAmountCents,
      maxAmountCents: tier.maxAmountCents,
      installmentCoefficientPpm: tier.installmentCoefficientPpm,
      sortOrder: tier.sortOrder,
    })),
  };
}

function promotionSnapshot(value: string): AdminPromotionRecord["normalConditionsSnapshot"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AdminPromotionRecord["normalConditionsSnapshot"])
      : null;
  } catch {
    return null;
  }
}

function promotionRecord(
  row: PromotionRow & { vehicleIds: string[] },
): AdminPromotionRecord {
  const snapshot = promotionSnapshot(row.normalConditionsSnapshotJson);
  return {
    ...row,
    status: row.status as AdminPromotionRecord["status"],
    normalConditionsSnapshot: snapshot,
    isDemo:
      snapshot?.demo === true ||
      row.publicCode.toUpperCase().includes("DEMO") ||
      row.title.toUpperCase().includes("DEMO"),
  };
}

function statusCounts<T extends string>(statuses: readonly T[], rows: Array<{ status: string }>): Record<T, number> {
  return Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row.status === status).length])) as Record<T, number>;
}

export function createAdminRepositoriesAdapter(
  data = new D1AdminRepository(),
): AdminRepositories {
  return {
    overview: {
      async get(at): Promise<AdminOverviewRecord> {
        const [stock, leads, appraisals, finance, promotions] = await Promise.all([
          data.listVehicles(), data.listLeads(), data.listAppraisals(),
          data.listFinanceVersions(), data.listPromotions(),
        ]);
        return {
          stock: statusCounts(["DRAFT", "AVAILABLE", "RESERVED", "SOLD", "PAUSED", "ARCHIVED"] as const, stock),
          leads: statusCounts(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const, leads),
          appraisals: statusCounts(["SUBMITTED", "IN_REVIEW", "ESTIMATED", "APPROVED", "REJECTED", "EXPIRED"] as const, appraisals),
          finance: statusCounts(["DRAFT", "PUBLISHED", "RETIRED"] as const, finance),
          promotions: statusCounts(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"] as const, promotions),
          generatedAt: at,
          isDemo: [...stock, ...leads, ...finance].some((row) =>
            ("source" in row && String(row.source).toUpperCase().includes("DEMO")) ||
            ("isDemo" in row && row.isDemo === true)),
        };
      },
    },
    stock: {
      async list(filters) {
        const rows = await data.listVehicles(filters?.status);
        const query = filters?.query?.toLowerCase();
        return rows
          .filter((row) => !query || `${row.make} ${row.model} ${row.trim} ${row.slug}`.toLowerCase().includes(query))
          .slice(0, filters?.limit ?? 100)
          .map(vehicleRecord);
      },
      async findById(id) {
        const row = await data.findVehicleById(id);
        return row ? vehicleRecord(row) : null;
      },
      async create(input, idempotencyKey, context) {
        const source = input.isDemo && !input.source.toUpperCase().includes("DEMO")
          ? `DEMO:${input.source}` : input.source;
        const result = await data.createVehicle({
          ...input, source, status: "DRAFT", publishedAt: null,
        }, {
          idempotencyKey,
          requestHash: context.requestHash,
          actor: context.actor,
          audit: audit(context.audit),
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        return { ok: true, record: vehicleRecord(result.record), replayed: result.replayed };
      },
      async update(input) {
        const patch = { ...input.patch } as Partial<VehicleRow> & { isDemo?: boolean };
        if (patch.isDemo !== undefined) {
          const current = await data.findVehicleById(input.id);
          if (current) {
            patch.source = patch.isDemo
              ? (current.source.toUpperCase().includes("DEMO") ? current.source : `DEMO:${current.source}`)
              : current.source.replace(/^DEMO:/i, "");
          }
          delete patch.isDemo;
        }
        return dataResult(await data.updateVehicle({
          id: input.id, expectedVersion: input.expectedVersion, patch,
          actor: input.actor, audit: audit(input.audit),
        }), vehicleRecord);
      },
      async archive(input) {
        return dataResult(await data.archiveVehicle({
          id: input.id, expectedVersion: input.expectedVersion,
          actor: input.actor, audit: audit(input.audit),
        }), vehicleRecord);
      },
    },
    leads: {
      async list(filters) {
        return (await data.listLeads(filters?.status)).slice(0, filters?.limit ?? 100).map(leadRecord);
      },
      async findById(id) {
        const row = await data.findLeadById(id);
        return row ? leadRecord(row) : null;
      },
      async transition(input) {
        return dataResult(await data.transitionLead({
          ...input, audit: audit(input.audit),
        }), leadRecord);
      },
    },
    appraisals: {
      async list(filters) {
        return (await data.listAppraisals(filters?.status)).slice(0, filters?.limit ?? 100).map(appraisalRecord);
      },
      async findById(id) {
        const row = await data.findAppraisalById(id);
        return row ? appraisalRecord(row) : null;
      },
      async review(input) {
        return dataResult(await data.reviewAppraisal({
          id: input.id, expectedVersion: input.expectedVersion, nextStatus: input.status,
          lowCents: input.lowCents, baseCents: input.baseCents, highCents: input.highCents,
          certaintyLevel: input.certaintyLevel, validUntil: input.validUntil,
          reviewNotes: input.notes, actor: input.actor, audit: audit(input.audit),
        }), appraisalRecord);
      },
    },
    finance: {
      async listVersions() {
        const rows = await data.listFinanceVersions();
        return Promise.all(rows.map(async (row) => financeRecord((await data.findFinanceVersion(row.id))!)));
      },
      async findById(id) {
        const row = await data.findFinanceVersion(id);
        return row ? financeRecord(row) : null;
      },
      async createVersion(input, idempotencyKey, context) {
        const result = await data.createFinanceVersion({
          id: input.id, version: input.version, name: input.name, provider: input.provider,
          status: "DRAFT", currency: "ARS", pricingKind: input.pricingKind,
          monthlyRateBps: input.monthlyRateBps,
          installmentCoefficientPpm: input.installmentCoefficientPpm,
          maxFinanceRatioBps: input.maxFinanceRatioBps,
          minimumDownPaymentRatioBps: input.minimumDownPaymentRatioBps,
          allowedVehicleTypesJson: JSON.stringify(input.allowedVehicleTypes),
          maxVehicleAgeYears: input.maxVehicleAgeYears,
          requiresPromotionId: input.requiresPromotionId,
          comfortablePaymentMarginBps: input.comfortablePaymentMarginBps,
          isDemo: input.isDemo, disclaimer: input.disclaimer,
          validFrom: input.validFrom, validUntil: input.validUntil,
        }, input.tiers.map((tier) => ({
          id: tier.id, financePlanVersionId: input.id, termMonths: tier.termMonths,
          minAmountCents: tier.minAmountCents, maxAmountCents: tier.maxAmountCents,
          installmentCoefficientPpm: tier.installmentCoefficientPpm, sortOrder: tier.sortOrder,
        })), {
          idempotencyKey, requestHash: context.requestHash, actor: context.actor,
          audit: audit(context.audit),
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        return { ok: true, record: financeRecord(result.record), replayed: result.replayed };
      },
      async setStatus(input) {
        const result = await data.setFinanceStatus({ ...input, audit: audit(input.audit) });
        if (!result.ok) return result;
        const complete = await data.findFinanceVersion(input.id);
        return complete
          ? { ok: true, record: financeRecord(complete) }
          : { ok: false, reason: "not_found" };
      },
    },
    promotions: {
      async list(filters) {
        const rows = await data.listPromotions(filters?.status);
        return Promise.all(rows.slice(0, filters?.limit ?? 100).map(async (row) =>
          promotionRecord((await data.findPromotionById(row.id))!)));
      },
      async findById(id) {
        const row = await data.findPromotionById(id);
        return row ? promotionRecord(row) : null;
      },
      async create(input, idempotencyKey, context) {
        const snapshot = { ...(input.normalConditionsSnapshot ?? {}), demo: input.isDemo };
        const result = await data.createPromotion({
          id: input.id, slug: input.slug, publicCode: input.publicCode, title: input.title,
          description: input.description, type: input.type, status: "DRAFT",
          discountCents: input.discountCents, tradeInBonusCents: input.tradeInBonusCents,
          financePlanVersionId: input.financePlanVersionId, stackable: input.stackable,
          normalConditionsSnapshotJson: JSON.stringify(snapshot), startsAt: input.startsAt,
          endsAt: input.endsAt,
        }, input.vehicleIds, {
          idempotencyKey, requestHash: context.requestHash, actor: context.actor,
          audit: audit(context.audit),
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        return { ok: true, record: promotionRecord(result.record), replayed: result.replayed };
      },
      async schedule(input) {
        return dataResult(await data.setPromotionStatus({
          ...input, audit: audit(input.audit),
        }), promotionRecord);
      },
      async setStatus(input) {
        return dataResult(await data.setPromotionStatus({
          ...input, audit: audit(input.audit),
        }), promotionRecord);
      },
    },
  };
}

export function adminDependencies(
  actor: AdminActor,
  data = new D1AdminRepository(),
) {
  return {
    repositories: createAdminRepositoriesAdapter(data),
    authorize: async () => actor,
  };
}
