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
    byteSize: integer("byte_size").notNull().default(0),
    sha256: text("sha256").notNull().default(""),
    status: text("status").notNull().default("PENDING"),
    sortOrder: integer("sort_order").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    version: integer("version").notNull().default(1),
    uploadedBy: text("uploaded_by").notNull().default("legacy"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("uq_vehicle_media_r2_key").on(table.r2Key),
    uniqueIndex("uq_vehicle_media_vehicle_sha256").on(table.vehicleId, table.sha256),
    index("idx_vehicle_media_status_order").on(
      table.vehicleId,
      table.status,
      table.sortOrder,
    ),
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
    createRequestHash: text("create_request_hash"),
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
    lockVersion: integer("lock_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
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
    uniqueIndex("uq_appraisal_media_capture").on(table.appraisalId, table.captureType),
    index("idx_appraisal_media_order").on(table.appraisalId, table.sortOrder),
  ],
);

export const consignments = sqliteTable(
  "consignment",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code").notNull(),
    idempotencyKey: text("idempotency_key"),
    commandHash: text("command_hash").notNull(),
    uploadTokenHash: text("upload_token_hash").notNull(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    year: integer("year").notNull(),
    mileageKm: integer("mileage_km").notNull(),
    declaredCondition: text("declared_condition").notNull(),
    askingPriceCents: integer("asking_price_cents"),
    ownerNotes: text("owner_notes"),
    status: text("status").notNull().default("SUBMITTED"),
    reviewedBy: text("reviewed_by"),
    reviewNotes: text("review_notes"),
    decidedAt: text("decided_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_consignment_public_code").on(table.publicCode),
    uniqueIndex("uq_consignment_idempotency_key").on(table.idempotencyKey),
    index("idx_consignment_status_updated").on(table.status, table.updatedAt),
    index("idx_consignment_lead").on(table.leadId),
  ],
);

export const consignmentMedia = sqliteTable(
  "consignment_media",
  {
    id: text("id").primaryKey(),
    consignmentId: text("consignment_id")
      .notNull()
      .references(() => consignments.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    captureType: text("capture_type").notNull(),
    status: text("status").notNull().default("PENDING"),
    requestHash: text("request_hash").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    uploadedAt: text("uploaded_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_consignment_media_r2_key").on(table.r2Key),
    // Only live rows hold a capture slot; ARCHIVED retries may reoccupy it.
    uniqueIndex("uq_consignment_media_capture")
      .on(table.consignmentId, table.captureType)
      .where(sql`status <> 'ARCHIVED'`),
    index("idx_consignment_media_order").on(table.consignmentId, table.sortOrder),
    index("idx_consignment_media_status").on(table.status, table.updatedAt),
  ],
);

// Contadores de abuso por ventana fija: el Worker no guarda estado en
// memoria; D1 es la única fuente y las filas vencen con la ventana.
export const rateLimitWindows = sqliteTable(
  "rate_limit_window",
  {
    key: text("key").primaryKey(),
    resource: text("resource").notNull(),
    expiresAt: text("expires_at").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (table) => [index("idx_rate_limit_expiry").on(table.expiresAt)],
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
    lockVersion: integer("lock_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_finance_plan_version").on(table.version),
    index("idx_finance_plan_status_window").on(table.status, table.validFrom, table.validUntil),
    index("idx_finance_plan_status_updated").on(table.status, table.updatedAt),
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
    index("idx_promotion_status_updated").on(table.status, table.updatedAt),
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
  (table) => [
    uniqueIndex("uq_lead_interest_lead_kind_simulation").on(
      table.leadId,
      table.kind,
      table.simulationId,
    ),
    uniqueIndex("uq_lead_interest_simulation").on(table.simulationId),
    index("idx_lead_interest_lead_created").on(table.leadId, table.createdAt),
  ],
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

/**
 * Cuenta del cliente. Es opcional por diseño: el catálogo, la tasación, el
 * buscador y la simulación siguen funcionando sin registrarse, y la cuenta
 * sólo agrega persistencia de lo que la persona ya hizo.
 *
 * Nunca se guarda la contraseña: `password_hash` es la derivación PBKDF2 y
 * `password_iterations` viaja con cada fila para poder endurecer el costo sin
 * invalidar las cuentas existentes.
 */
export const customerAccounts = sqliteTable(
  "customer_account",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordAlgorithm: text("password_algorithm").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    name: text("name").notNull(),
    phoneNormalized: text("phone_normalized"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    status: text("status").notNull().default("ACTIVE"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastLoginAt: text("last_login_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_customer_account_email").on(table.email),
    index("idx_customer_account_lead").on(table.leadId),
  ],
);

/** De la sesión sólo se persiste el SHA-256 del token entregado al navegador. */
export const customerSessions = sqliteTable(
  "customer_session",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_customer_session_token").on(table.tokenHash),
    index("idx_customer_session_account").on(table.accountId, table.expiresAt),
  ],
);

/** Presupuesto, cuota y preferencias declaradas por la persona. */
export const customerPreferences = sqliteTable("customer_preference", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => customerAccounts.id, { onDelete: "cascade" }),
  budgetCents: integer("budget_cents"),
  maxMonthlyPaymentCents: integer("max_monthly_payment_cents"),
  currency: text("currency").notNull().default("ARS"),
  preferredMakesJson: text("preferred_makes_json").notNull().default("[]"),
  preferredBodyTypesJson: text("preferred_body_types_json").notNull().default("[]"),
  currentVehicleJson: text("current_vehicle_json"),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerFavorites = sqliteTable(
  "customer_favorite",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_customer_favorite").on(table.accountId, table.vehicleId),
    index("idx_customer_favorite_account").on(table.accountId, table.createdAt),
  ],
);

export const customerSavedSearches = sqliteTable(
  "customer_saved_search",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_customer_saved_search_name").on(table.accountId, table.name),
    index("idx_customer_saved_search_account").on(table.accountId, table.createdAt),
  ],
);

export const adminIdempotency = sqliteTable(
  "admin_idempotency",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_admin_idempotency_scope_key").on(table.scope, table.idempotencyKey),
    index("idx_admin_idempotency_resource").on(table.resourceType, table.resourceId),
  ],
);

export const adminAuditLogs = sqliteTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    previousVersion: integer("previous_version"),
    nextVersion: integer("next_version"),
    summaryJson: text("summary_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("idx_admin_audit_resource_occurred").on(
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    index("idx_admin_audit_actor_occurred").on(table.actorUserId, table.occurredAt),
  ],
);

export const channelAccounts = sqliteTable(
  "channel_account",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("ZERNIO"),
    platform: text("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    defaultAssignee: text("default_assignee"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_channel_account_provider_external").on(
      table.provider,
      table.externalAccountId,
    ),
    index("idx_channel_account_platform_status").on(table.platform, table.status),
  ],
);

export const channelWebhookEvents = sqliteTable(
  "channel_webhook_event",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("ZERNIO"),
    externalEventId: text("external_event_id").notNull(),
    type: text("type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("RECEIVED"),
    failureReason: text("failure_reason"),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_channel_webhook_event_provider_external").on(
      table.provider,
      table.externalEventId,
    ),
    index("idx_channel_webhook_event_status_received").on(table.status, table.receivedAt),
  ],
);

export const inboxConversations = sqliteTable(
  "inbox_conversation",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull().default("ZERNIO"),
    externalConversationId: text("external_conversation_id").notNull(),
    channelAccountId: text("channel_account_id")
      .notNull()
      .references(() => channelAccounts.id, { onDelete: "restrict" }),
    platform: text("platform").notNull(),
    participantExternalId: text("participant_external_id").notNull(),
    participantPhoneNormalized: text("participant_phone_normalized"),
    participantDisplayName: text("participant_display_name"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    status: text("status").notNull().default("OPEN"),
    handling: text("handling").notNull().default("HUMAN"),
    assignedTo: text("assigned_to"),
    followUpAt: text("follow_up_at"),
    followUpNote: text("follow_up_note"),
    lastInboundAt: text("last_inbound_at"),
    lastOutboundAt: text("last_outbound_at"),
    firstResponseAt: text("first_response_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_inbox_conversation_provider_external").on(
      table.provider,
      table.externalConversationId,
    ),
    index("idx_inbox_conversation_status_inbound").on(table.status, table.lastInboundAt),
    index("idx_inbox_conversation_assigned_inbound").on(
      table.assignedTo,
      table.lastInboundAt,
    ),
    index("idx_inbox_conversation_status_follow_up").on(table.status, table.followUpAt),
    index("idx_inbox_conversation_lead").on(table.leadId),
  ],
);

export const inboxMessages = sqliteTable(
  "inbox_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("ZERNIO"),
    externalMessageId: text("external_message_id").notNull(),
    platformMessageId: text("platform_message_id"),
    direction: text("direction").notNull(),
    authorType: text("author_type").notNull(),
    authorId: text("author_id"),
    text: text("text"),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    simulationId: text("simulation_id").references(() => simulations.id, {
      onDelete: "set null",
    }),
    appraisalId: text("appraisal_id").references(() => appraisals.id, {
      onDelete: "set null",
    }),
    deliveryStatus: text("delivery_status"),
    deliveryError: text("delivery_error"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uq_inbox_message_provider_external").on(
      table.provider,
      table.externalMessageId,
    ),
    index("idx_inbox_message_conversation_occurred").on(
      table.conversationId,
      table.occurredAt,
    ),
  ],
);

export const buyerPassports = sqliteTable(
  "buyer_passport",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => inboxConversations.id, {
      onDelete: "set null",
    }),
    /** Capability secreta: sólo se persiste su SHA-256. */
    reviewTokenHash: text("review_token_hash"),
    status: text("status").notNull().default("DRAFT"),
    budgetCents: integer("budget_cents"),
    downPaymentCents: integer("down_payment_cents"),
    maxMonthlyPaymentCents: integer("max_monthly_payment_cents"),
    currency: text("currency").notNull().default("ARS"),
    desiredMakesJson: text("desired_makes_json").notNull().default("[]"),
    desiredModelsJson: text("desired_models_json").notNull().default("[]"),
    acceptedTypesJson: text("accepted_types_json").notNull().default("[]"),
    minYear: integer("min_year"),
    maxMileageKm: integer("max_mileage_km"),
    primaryUse: text("primary_use"),
    needsFinancing: integer("needs_financing", { mode: "boolean" }),
    tradeInAppraisalId: text("trade_in_appraisal_id").references(() => appraisals.id, {
      onDelete: "set null",
    }),
    tradeInDescription: text("trade_in_description"),
    urgencyDays: integer("urgency_days"),
    locality: text("locality"),
    maxDistanceKm: integer("max_distance_km"),
    mandatoryConditionsJson: text("mandatory_conditions_json").notNull().default("[]"),
    negotiableConditionsJson: text("negotiable_conditions_json").notNull().default("[]"),
    /** Cuándo lo confirmó el cliente. Sin confirmación no se busca a su nombre. */
    confirmedAt: text("confirmed_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_buyer_passport_lead").on(table.leadId),
    uniqueIndex("uq_buyer_passport_review_token").on(table.reviewTokenHash),
    index("idx_buyer_passport_status_updated").on(table.status, table.updatedAt),
  ],
);

export const visitRequests = sqliteTable(
  "visit_request",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => inboxConversations.id, {
      onDelete: "set null",
    }),
    vehicleId: text("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    requestedAt: text("requested_at").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    assignedTo: text("assigned_to"),
    note: text("note"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("idx_visit_request_status_requested").on(table.status, table.requestedAt),
    index("idx_visit_request_lead").on(table.leadId),
  ],
);

export const demands = sqliteTable(
  "demand",
  {
    id: text("id").primaryKey(),
    publicCode: text("public_code").notNull(),
    passportId: text("passport_id")
      .notNull()
      .references(() => buyerPassports.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("OPEN"),
    criteriaJson: text("criteria_json").notNull(),
    /** Vigencia: una demanda vieja no se sigue tratando como caliente. */
    validUntil: text("valid_until").notNull(),
    assignedTo: text("assigned_to"),
    closedReason: text("closed_reason"),
    closedAt: text("closed_at"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_demand_public_code").on(table.publicCode),
    index("idx_demand_status_valid").on(table.status, table.validUntil),
    index("idx_demand_lead").on(table.leadId),
  ],
);

export const demandMatches = sqliteTable(
  "demand_match",
  {
    id: text("id").primaryKey(),
    demandId: text("demand_id")
      .notNull()
      .references(() => demands.id, { onDelete: "cascade" }),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    /** Coincidencia en puntos básicos (10000 = 100%), calculada con criterios explícitos. */
    scoreBps: integer("score_bps").notNull(),
    breakdownJson: text("breakdown_json").notNull().default("{}"),
    status: text("status").notNull().default("NEW"),
    notifiedTo: text("notified_to"),
    notifiedAt: text("notified_at"),
    respondedAt: text("responded_at"),
    visitedAt: text("visited_at"),
    purchasedAt: text("purchased_at"),
    discardedReason: text("discarded_reason"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("uq_demand_match_demand_vehicle").on(table.demandId, table.vehicleId),
    index("idx_demand_match_status_score").on(table.status, table.scoreBps),
    index("idx_demand_match_vehicle").on(table.vehicleId),
  ],
);

export type BusinessProfileRow = typeof businessProfiles.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;
export type VehicleMediaRow = typeof vehicleMedia.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type AppraisalRow = typeof appraisals.$inferSelect;
export type SimulationRow = typeof simulations.$inferSelect;
export type PromotionRow = typeof promotions.$inferSelect;
export type ConsignmentRow = typeof consignments.$inferSelect;
export type ConsignmentMediaRow = typeof consignmentMedia.$inferSelect;

export type FinancePlanVersionRow = typeof financePlanVersions.$inferSelect;
export type FinancePlanTierRow = typeof financePlanTiers.$inferSelect;
export type AdminAuditLogRow = typeof adminAuditLogs.$inferSelect;
export type CustomerAccountRow = typeof customerAccounts.$inferSelect;
export type CustomerSessionRow = typeof customerSessions.$inferSelect;
export type CustomerPreferenceRow = typeof customerPreferences.$inferSelect;
export type CustomerFavoriteRow = typeof customerFavorites.$inferSelect;
export type CustomerSavedSearchRow = typeof customerSavedSearches.$inferSelect;
export type ChannelAccountRow = typeof channelAccounts.$inferSelect;
export type ChannelWebhookEventRow = typeof channelWebhookEvents.$inferSelect;
export type InboxConversationRow = typeof inboxConversations.$inferSelect;
export type InboxMessageRow = typeof inboxMessages.$inferSelect;
export type BuyerPassportRow = typeof buyerPassports.$inferSelect;
export type DemandRow = typeof demands.$inferSelect;
export type DemandMatchRow = typeof demandMatches.$inferSelect;
