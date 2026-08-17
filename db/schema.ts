import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = () =>
  text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const businessProfiles = sqliteTable("business_profile", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  phoneNational: text("phone_national").notNull(),
  whatsappE164: text("whatsapp_e164"),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
  locale: text("locale").notNull(),
  mapUrl: text("map_url"),
  hoursJson: text("hours_json"),
  socialLinksJson: text("social_links_json"),
  stockFreshnessMinutes: integer("stock_freshness_minutes").notNull().default(1440),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vehicles = sqliteTable(
  "vehicle",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    externalCode: text("external_code"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim").notNull(),
    year: integer("year").notNull(),
    mileageKm: integer("mileage_km").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("ARS"),
    priceValidUntil: text("price_valid_until"),
    bodyType: text("body_type").notNull(),
    fuelType: text("fuel_type").notNull(),
    transmission: text("transmission").notNull(),
    color: text("color").notNull(),
    status: text("status").notNull().default("DRAFT"),
    source: text("source").notNull().default("manual"),
    lastSyncedAt: text("last_synced_at"),
    publishedAt: text("published_at"),
    internalNotes: text("internal_notes"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_vehicle_slug").on(table.slug),
    uniqueIndex("uq_vehicle_external_code").on(table.externalCode),
    index("idx_vehicle_status_updated").on(table.status, table.updatedAt),
    index("idx_vehicle_make_model").on(table.make, table.model),
  ],
);

export const vehicleMedia = sqliteTable(
  "vehicle_media",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    publicUrl: text("public_url"),
    contentType: text("content_type").notNull(),
    altText: text("alt_text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_vehicle_media_r2_key").on(table.r2Key),
    index("idx_vehicle_media_order").on(table.vehicleId, table.sortOrder),
  ],
);

export const vehiclePriceHistory = sqliteTable(
  "vehicle_price_history",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until"),
    changedBy: text("changed_by").notNull(),
    changeReason: text("change_reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_vehicle_price_history_vehicle").on(table.vehicleId, table.validFrom)],
);

export const externalStockMappings = sqliteTable(
  "external_stock_mapping",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    payloadHash: text("payload_hash"),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_external_stock_provider_id").on(table.provider, table.externalId),
    uniqueIndex("uq_external_stock_vehicle_provider").on(table.vehicleId, table.provider),
  ],
);

export const stockSyncRuns = sqliteTable(
  "stock_sync_run",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsChanged: integer("records_changed").notNull().default(0),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
    createdAt: createdAt(),
  },
  (table) => [index("idx_stock_sync_provider_started").on(table.provider, table.startedAt)],
);

export const leads = sqliteTable(
  "lead",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key"),
    name: text("name").notNull(),
    phoneNormalized: text("phone_normalized").notNull(),
    email: text("email"),
    source: text("source").notNull(),
    status: text("status").notNull().default("NEW"),
    score: integer("score").notNull().default(0),
    assignedTo: text("assigned_to"),
    lostReason: text("lost_reason"),
    lastContactedAt: text("last_contacted_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_lead_idempotency_key").on(table.idempotencyKey),
    index("idx_lead_status_updated").on(table.status, table.updatedAt),
    index("idx_lead_phone").on(table.phoneNormalized),
  ],
);

export const appraisalRuleSets = sqliteTable(
  "appraisal_rule_set",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("DRAFT"),
    rulesJson: text("rules_json").notNull(),
    validFrom: text("valid_from"),
    validUntil: text("valid_until"),
    publishedBy: text("published_by"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("uq_appraisal_rule_set_version").on(table.version)],
);

export const appraisals = sqliteTable(
  "appraisal",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code").notNull(),
    idempotencyKey: text("idempotency_key"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    year: integer("year").notNull(),
    mileageKm: integer("mileage_km").notNull(),
    declaredCondition: text("declared_condition").notNull(),
    documentationStatus: text("documentation_status"),
    hasLien: integer("has_lien", { mode: "boolean" }).notNull().default(false),
    repairNotes: text("repair_notes"),
    status: text("status").notNull().default("SUBMITTED"),
    certaintyLevel: text("certainty_level").notNull().default("T0"),
    lowCents: integer("low_cents"),
    baseCents: integer("base_cents"),
    highCents: integer("high_cents"),
    currency: text("currency").notNull().default("ARS"),
    ruleSetId: text("rule_set_id").references(() => appraisalRuleSets.id, {
      onDelete: "set null",
    }),
    reviewedBy: text("reviewed_by"),
    reviewNotes: text("review_notes"),
    validUntil: text("valid_until"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_appraisal_public_code").on(table.publicCode),
    uniqueIndex("uq_appraisal_idempotency_key").on(table.idempotencyKey),
    index("idx_appraisal_status_updated").on(table.status, table.updatedAt),
    index("idx_appraisal_lead").on(table.leadId),
  ],
);

export const appraisalMedia = sqliteTable(
  "appraisal_media",
  {
    id: text("id").primaryKey(),
    appraisalId: text("appraisal_id")
      .notNull()
      .references(() => appraisals.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    captureType: text("capture_type").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    uploadedAt: text("uploaded_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_appraisal_media_r2_key").on(table.r2Key),
    index("idx_appraisal_media_order").on(table.appraisalId, table.sortOrder),
  ],
);

export const financePlanVersions = sqliteTable(
  "finance_plan_version",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("ARS"),
    pricingKind: text("pricing_kind").notNull(),
    monthlyRateBps: integer("monthly_rate_bps"),
    installmentCoefficientPpm: integer("installment_coefficient_ppm"),
    maxFinanceRatioBps: integer("max_finance_ratio_bps").notNull(),
    minimumDownPaymentRatioBps: integer("minimum_down_payment_ratio_bps").notNull(),
    allowedVehicleTypesJson: text("allowed_vehicle_types_json").notNull(),
    maxVehicleAgeYears: integer("max_vehicle_age_years").notNull(),
    requiresPromotionId: text("requires_promotion_id"),
    comfortablePaymentMarginBps: integer("comfortable_payment_margin_bps")
      .notNull()
      .default(1000),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    disclaimer: text("disclaimer").notNull(),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until").notNull(),
    publishedAt: text("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_finance_plan_version").on(table.version),
    index("idx_finance_plan_status_window").on(table.status, table.validFrom, table.validUntil),
  ],
);

export const financePlanTiers = sqliteTable(
  "finance_plan_tier",
  {
    id: text("id").primaryKey(),
    financePlanVersionId: text("finance_plan_version_id")
      .notNull()
      .references(() => financePlanVersions.id, { onDelete: "cascade" }),
    termMonths: integer("term_months").notNull(),
    minAmountCents: integer("min_amount_cents").notNull(),
    maxAmountCents: integer("max_amount_cents").notNull(),
    installmentCoefficientPpm: integer("installment_coefficient_ppm"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_finance_plan_tier_band").on(
      table.financePlanVersionId,
      table.termMonths,
      table.minAmountCents,
    ),
    index("idx_finance_plan_tier_plan_order").on(
      table.financePlanVersionId,
      table.sortOrder,
    ),
  ],
);

export const promotions = sqliteTable(
  "promotion",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    publicCode: text("public_code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("DRAFT"),
    discountCents: integer("discount_cents").notNull().default(0),
    tradeInBonusCents: integer("trade_in_bonus_cents").notNull().default(0),
    financePlanVersionId: text("finance_plan_version_id").references(
      () => financePlanVersions.id,
      { onDelete: "set null" },
    ),
    stackable: integer("stackable", { mode: "boolean" }).notNull().default(false),
    normalConditionsSnapshotJson: text("normal_conditions_snapshot_json").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    publishedAt: text("published_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_promotion_slug").on(table.slug),
    uniqueIndex("uq_promotion_public_code").on(table.publicCode),
    index("idx_promotion_status_window").on(table.status, table.startsAt, table.endsAt),
  ],
);

export const promotionVehicles = sqliteTable(
  "promotion_vehicle",
  {
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.promotionId, table.vehicleId] }),
    index("idx_promotion_vehicle_vehicle").on(table.vehicleId),
  ],
);

export const simulations = sqliteTable(
  "simulation",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code").notNull(),
    idempotencyKey: text("idempotency_key"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    vehicleId: text("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    appraisalId: text("appraisal_id").references(() => appraisals.id, {
      onDelete: "set null",
    }),
    promotionId: text("promotion_id").references(() => promotions.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("ACTIVE"),
    classification: text("classification").notNull(),
    certaintyLevel: text("certainty_level").notNull(),
    vehiclePriceCents: integer("vehicle_price_cents").notNull(),
    effectivePriceCents: integer("effective_price_cents").notNull(),
    appraisalAppliedCents: integer("appraisal_applied_cents").notNull().default(0),
    tradeInBonusCents: integer("trade_in_bonus_cents").notNull().default(0),
    cashCents: integer("cash_cents").notNull().default(0),
    financePrincipalCents: integer("finance_principal_cents").notNull().default(0),
    termMonths: integer("term_months"),
    installmentCents: integer("installment_cents"),
    totalCostCents: integer("total_cost_cents"),
    currency: text("currency").notNull().default("ARS"),
    engineVersion: text("engine_version").notNull(),
    ruleVersion: text("rule_version").notNull(),
    financePlanVersion: text("finance_plan_version"),
    inputSnapshotJson: text("input_snapshot_json").notNull(),
    resultSnapshotJson: text("result_snapshot_json").notNull(),
    disclaimerSnapshot: text("disclaimer_snapshot").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_simulation_public_code").on(table.publicCode),
    uniqueIndex("uq_simulation_idempotency_key").on(table.idempotencyKey),
    index("idx_simulation_lead_created").on(table.leadId, table.createdAt),
    index("idx_simulation_vehicle_created").on(table.vehicleId, table.createdAt),
  ],
);

export const leadInterests = sqliteTable(
  "lead_interest",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    vehicleId: text("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    appraisalId: text("appraisal_id").references(() => appraisals.id, {
      onDelete: "set null",
    }),
    simulationId: text("simulation_id").references(() => simulations.id, {
      onDelete: "set null",
    }),
    promotionId: text("promotion_id").references(() => promotions.id, {
      onDelete: "set null",
    }),
    contextJson: text("context_json").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (table) => [index("idx_lead_interest_lead_created").on(table.leadId, table.createdAt)],
);

export const leadEvents = sqliteTable(
  "lead_event",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_lead_event_lead_occurred").on(table.leadId, table.occurredAt)],
);

export const consents = sqliteTable(
  "consent",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    purpose: text("purpose").notNull(),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
    evidenceJson: text("evidence_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("idx_consent_lead_purpose").on(table.leadId, table.purpose)],
);

export type BusinessProfileRow = typeof businessProfiles.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type VehicleMediaRow = typeof vehicleMedia.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type AppraisalRow = typeof appraisals.$inferSelect;
export type SimulationRow = typeof simulations.$inferSelect;
export type PromotionRow = typeof promotions.$inferSelect;
export type FinancePlanVersionRow = typeof financePlanVersions.$inferSelect;
export type FinancePlanTierRow = typeof financePlanTiers.$inferSelect;
