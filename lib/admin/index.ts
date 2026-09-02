/**
 * Casos de uso del panel operativo.
 *
 * Este módulo no conoce D1 ni Next.js. Las mutaciones de los repositorios deben
 * persistir el cambio y `audit` en una única operación atómica. No existe ningún
 * contrato de borrado físico.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type VehicleStatus =
  | "DRAFT"
  | "AVAILABLE"
  | "RESERVED"
  | "SOLD"
  | "PAUSED"
  | "ARCHIVED";
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "WON" | "LOST";
export type AppraisalStatus =
  | "SUBMITTED"
  | "IN_REVIEW"
  | "ESTIMATED"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED";
export type ConsignmentStatus = "SUBMITTED" | "IN_REVIEW" | "ACCEPTED" | "REJECTED";
export type FinanceStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type PromotionStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "EXPIRED"
  | "ARCHIVED";
/** T0 = preliminar/remota; T1 = revisión humana con evidencia suficiente. */
export type CertaintyLevel = "T0" | "T1";
export type FinancePricingKind = "french" | "coefficient" | "table";
/**
 * Moneda de publicación de una unidad. El tarifario financiero se emite en ARS,
 * así que sólo las unidades en pesos son simulables; las cotizadas en dólares se
 * publican con su precio real y la financiación se cotiza en el salón.
 */
export type VehicleCurrency = "ARS" | "USD";

export interface AdminActor {
  userId: string;
  email: string;
  displayName: string;
}

export interface AdminAuditCommand {
  eventId: string;
  entityType: "VEHICLE" | "LEAD" | "APPRAISAL" | "CONSIGNMENT" | "FINANCE_VERSION" | "PROMOTION";
  entityId: string;
  action: string;
  occurredAt: string;
  expectedVersion: number | null;
  summary: Readonly<Record<string, JsonPrimitive>>;
}

export interface AdminVehicleRecord {
  id: string;
  slug: string;
  externalCode: string | null;
  make: string;
  model: string;
  trim: string;
  year: number;
  mileageKm: number;
  priceCents: number;
  currency: VehicleCurrency;
  priceValidUntil: string | null;
  bodyType: string;
  fuelType: string;
  transmission: string;
  color: string;
  status: VehicleStatus;
  source: string;
  internalNotes: string | null;
  version: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface AdminLeadRecord {
  id: string;
  name: string;
  phoneMasked: string;
  status: LeadStatus;
  assignedTo: string | null;
  lostReason: string | null;
  source: string;
  vehicleId: string | null;
  vehicleSlug: string | null;
  vehicleLabel: string | null;
  simulationCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface AdminAppraisalRecord {
  id: string;
  leadId: string | null;
  vehicleDescription: string;
  status: AppraisalStatus;
  lowCents: number | null;
  baseCents: number | null;
  highCents: number | null;
  currency: "ARS";
  certaintyLevel: CertaintyLevel | null;
  validUntil: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface AdminConsignmentRecord {
  id: string;
  leadId: string | null;
  vehicleDescription: string;
  year: number;
  mileageKm: number;
  status: ConsignmentStatus;
  askingPriceCents: number | null;
  currency: "ARS";
  ownerNotes: string | null;
  notes: string | null;
  reviewedBy: string | null;
  decidedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface FinanceTierRecord {
  id: string;
  termMonths: number;
  minAmountCents: number;
  maxAmountCents: number;
  installmentCoefficientPpm: number | null;
  sortOrder: number;
}

export interface FinanceVersionRecord {
  id: string;
  version: string;
  lockVersion: number;
  name: string;
  provider: string;
  currency: "ARS";
  status: FinanceStatus;
  pricingKind: FinancePricingKind;
  monthlyRateBps: number | null;
  installmentCoefficientPpm: number | null;
  maxFinanceRatioBps: number;
  minimumDownPaymentRatioBps: number;
  allowedVehicleTypes: string[];
  maxVehicleAgeYears: number;
  requiresPromotionId: string | null;
  comfortablePaymentMarginBps: number;
  validFrom: string;
  validUntil: string;
  disclaimer: string;
  tiers: FinanceTierRecord[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface AdminPromotionRecord {
  id: string;
  slug: string;
  publicCode: string;
  title: string;
  description: string;
  type: string;
  status: PromotionStatus;
  vehicleIds: string[];
  startsAt: string;
  endsAt: string;
  discountCents: number;
  tradeInBonusCents: number;
  financePlanVersionId: string | null;
  stackable: boolean;
  normalConditionsSnapshot: Readonly<Record<string, JsonValue>> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface AdminOverviewRecord {
  stock: Readonly<Record<VehicleStatus, number>>;
  leads: Readonly<Record<LeadStatus, number>>;
  appraisals: Readonly<Record<AppraisalStatus, number>>;
  consignments: Readonly<Record<ConsignmentStatus, number>>;
  finance: Readonly<Record<FinanceStatus, number>>;
  promotions: Readonly<Record<PromotionStatus, number>>;
  generatedAt: string;
  isDemo: boolean;
}

export type MutationResult<T> =
  | { ok: true; record: T; replayed?: boolean }
  | { ok: false; reason: "not_found" | "conflict" | "idempotency_conflict"; currentVersion?: number };

export interface StockFilters {
  status?: VehicleStatus;
  query?: string;
  limit?: number;
  cursor?: string;
}

export interface LeadFilters {
  status?: LeadStatus;
  assignedTo?: string;
  limit?: number;
  cursor?: string;
}

export interface AppraisalFilters {
  status?: AppraisalStatus;
  limit?: number;
  cursor?: string;
}

export interface ConsignmentFilters {
  status?: ConsignmentStatus;
  limit?: number;
  cursor?: string;
}

export interface PromotionFilters {
  status?: PromotionStatus;
  limit?: number;
  cursor?: string;
}

interface MutationContext {
  actor: AdminActor;
  audit: AdminAuditCommand;
  /** SHA-256 canónico del comando, sin IDs generados por el servidor. */
  requestHash: string;
}

export interface StockRepository {
  list(filters?: StockFilters): Promise<AdminVehicleRecord[]>;
  findById(id: string): Promise<AdminVehicleRecord | null>;
  create(
    input: Omit<AdminVehicleRecord, "version" | "publishedAt" | "createdAt" | "updatedAt">,
    idempotencyKey: string,
    context: MutationContext,
  ): Promise<MutationResult<AdminVehicleRecord>>;
  update(input: {
    id: string;
    expectedVersion: number;
    patch: Partial<AdminVehicleRecord>;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminVehicleRecord>>;
  archive(input: {
    id: string;
    expectedVersion: number;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminVehicleRecord>>;
}

export interface LeadRepository {
  list(filters?: LeadFilters): Promise<AdminLeadRecord[]>;
  findById(id: string): Promise<AdminLeadRecord | null>;
  transition(input: {
    id: string;
    expectedVersion: number;
    nextStatus: LeadStatus;
    assignedTo?: string;
    lostReason?: string;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminLeadRecord>>;
}

export interface AppraisalRepository {
  list(filters?: AppraisalFilters): Promise<AdminAppraisalRecord[]>;
  findById(id: string): Promise<AdminAppraisalRecord | null>;
  review(input: {
    id: string;
    expectedVersion: number;
    status: AppraisalStatus;
    lowCents?: number;
    baseCents?: number;
    highCents?: number;
    currency?: "ARS";
    certaintyLevel?: CertaintyLevel;
    validUntil?: string;
    notes?: string;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminAppraisalRecord>>;
}

export interface ConsignmentRepository {
  list(filters?: ConsignmentFilters): Promise<AdminConsignmentRecord[]>;
  findById(id: string): Promise<AdminConsignmentRecord | null>;
  countReadyMedia(id: string): Promise<number>;
  review(input: {
    id: string;
    expectedVersion: number;
    status: ConsignmentStatus;
    notes?: string;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminConsignmentRecord>>;
}

export interface FinanceRepository {
  listVersions(): Promise<FinanceVersionRecord[]>;
  findById(id: string): Promise<FinanceVersionRecord | null>;
  createVersion(
    input: Omit<FinanceVersionRecord, "lockVersion" | "publishedAt" | "createdAt" | "updatedAt">,
    idempotencyKey: string,
    context: MutationContext,
  ): Promise<MutationResult<FinanceVersionRecord>>;
  setStatus(input: {
    id: string;
    expectedVersion: number;
    nextStatus: "PUBLISHED" | "RETIRED";
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<FinanceVersionRecord>>;
}

export interface PromotionRepository {
  list(filters?: PromotionFilters): Promise<AdminPromotionRecord[]>;
  findById(id: string): Promise<AdminPromotionRecord | null>;
  create(
    input: Omit<AdminPromotionRecord, "version" | "createdAt" | "updatedAt">,
    idempotencyKey: string,
    context: MutationContext,
  ): Promise<MutationResult<AdminPromotionRecord>>;
  schedule(input: {
    id: string;
    expectedVersion: number;
    nextStatus: "SCHEDULED";
    startsAt: string;
    endsAt: string;
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminPromotionRecord>>;
  setStatus(input: {
    id: string;
    expectedVersion: number;
    nextStatus: "ACTIVE" | "PAUSED" | "EXPIRED" | "ARCHIVED";
    actor: AdminActor;
    audit: AdminAuditCommand;
  }): Promise<MutationResult<AdminPromotionRecord>>;
}

export interface AdminRepositories {
  overview: { get(at: string): Promise<AdminOverviewRecord> };
  stock: StockRepository;
  leads: LeadRepository;
  appraisals: AppraisalRepository;
  consignments: ConsignmentRepository;
  finance: FinanceRepository;
  promotions: PromotionRepository;
}

export interface AdminDependencies {
  repositories: AdminRepositories;
  authorize?: () => Promise<AdminActor>;
  clock?: () => Date;
  idGenerator?: () => string;
}

export type AdminErrorCode =
  | "ADMIN_INVALID_INPUT"
  | "ADMIN_INVALID_TRANSITION"
  | "ADMIN_NOT_FOUND"
  | "ADMIN_VERSION_CONFLICT"
  | "ADMIN_IDEMPOTENCY_CONFLICT"
  | "ADMIN_CONFIGURATION_ERROR";

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  readonly status: number;
  readonly details?: Readonly<Record<string, JsonValue>>;

  constructor(
    code: AdminErrorCode,
    message: string,
    status: number,
    details?: Readonly<Record<string, JsonValue>>,
  ) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): Readonly<Record<string, JsonValue>> {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const ERROR_MESSAGES = {
  invalid: "Hay datos inválidos. Revisá los campos e intentá nuevamente.",
  transition: "El cambio de estado no está permitido.",
  notFound: "No encontramos el recurso solicitado.",
  conflict: "El registro cambió. Recargá la información e intentá nuevamente.",
  idempotency: "La clave de idempotencia ya fue usada con otros datos.",
  configuration: "No pudimos completar la operación de forma segura.",
} as const;

function invalid(fields: Record<string, string>): never {
  throw new AdminError("ADMIN_INVALID_INPUT", ERROR_MESSAGES.invalid, 400, { fields });
}

function invalidTransition(current: string, next: string): never {
  throw new AdminError("ADMIN_INVALID_TRANSITION", ERROR_MESSAGES.transition, 409, {
    current,
    next,
  });
}

function requiredString(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    invalid({ [field]: `Debe tener entre 1 y ${maximum} caracteres.` });
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maximum = 1_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, field, maximum);
}

function safeInteger(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid({ [field]: `Debe ser un entero entre ${minimum} y ${maximum}.` });
  }
  return value as number;
}

function ars(value: unknown, field: string, allowZero = true): number {
  return safeInteger(value, field, allowZero ? 0 : 1);
}

function version(value: unknown): number {
  return safeInteger(value, "expectedVersion", 1);
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== "string") invalid({ [field]: "Debe ser una fecha ISO válida." });
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid({ [field]: "Debe ser una fecha ISO válida." });
  return parsed.toISOString();
}

function idempotencyKey(value: unknown): string {
  const key = requiredString(value, "idempotencyKey", 128);
  if (key.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    invalid({ idempotencyKey: "Debe tener entre 8 y 128 caracteres seguros." });
  }
  return key;
}

function vehicleCurrency(value: unknown): VehicleCurrency {
  if (value !== "ARS" && value !== "USD") {
    invalid({ currency: "Las monedas admitidas son ARS y USD." });
  }
  return value as VehicleCurrency;
}

function currency(value: unknown): "ARS" {
  if (value !== "ARS") invalid({ currency: "La moneda admitida es ARS." });
  return "ARS";
}

function now(dependencies: AdminDependencies): { date: Date; iso: string } {
  const date = dependencies.clock?.() ?? new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new AdminError("ADMIN_CONFIGURATION_ERROR", ERROR_MESSAGES.configuration, 500);
  }
  return { date, iso: date.toISOString() };
}

async function authorize(dependencies: AdminDependencies): Promise<AdminActor> {
  const identity = dependencies.authorize
    ? await dependencies.authorize()
    : await defaultAuthorize();
  if (
    !identity ||
    typeof identity.userId !== "string" ||
    typeof identity.email !== "string" ||
    typeof identity.displayName !== "string"
  ) {
    throw new AdminError("ADMIN_CONFIGURATION_ERROR", ERROR_MESSAGES.configuration, 500);
  }
  return Object.freeze({
    userId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
  });
}

async function defaultAuthorize(): Promise<AdminActor> {
  const { requirePanelUser } = await import("../server/panel-auth");
  const user = await requirePanelUser("/panel");
  return { userId: user.userId, email: user.email, displayName: user.displayName };
}

function makeAudit(
  dependencies: AdminDependencies,
  entityType: AdminAuditCommand["entityType"],
  entityId: string,
  action: string,
  expectedVersion: number | null,
  occurredAt: string,
  summary: Record<string, JsonPrimitive>,
): AdminAuditCommand {
  const eventId = dependencies.idGenerator?.() ?? crypto.randomUUID();
  return Object.freeze({
    eventId: requiredString(eventId, "audit.eventId", 200),
    entityType,
    entityId,
    action,
    occurredAt,
    expectedVersion,
    summary: Object.freeze({ ...summary }),
  });
}

function makeId(dependencies: AdminDependencies): string {
  return requiredString(dependencies.idGenerator?.() ?? crypto.randomUUID(), "id", 200);
}

function dto<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") throw new TypeError("bigint");
      return item;
    });
    if (serialized === undefined) throw new TypeError("undefined");
    return deepFreeze(JSON.parse(serialized) as T);
  } catch {
    throw new AdminError("ADMIN_CONFIGURATION_ERROR", ERROR_MESSAGES.configuration, 500);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function resolveMutation<T>(result: MutationResult<T>): T {
  if (result.ok) return dto(result.record);
  if (result.reason === "not_found") {
    throw new AdminError("ADMIN_NOT_FOUND", ERROR_MESSAGES.notFound, 404);
  }
  if (result.reason === "idempotency_conflict") {
    throw new AdminError("ADMIN_IDEMPOTENCY_CONFLICT", ERROR_MESSAGES.idempotency, 409);
  }
  throw new AdminError("ADMIN_VERSION_CONFLICT", ERROR_MESSAGES.conflict, 409, {
    ...(result.currentVersion === undefined ? {} : { currentVersion: result.currentVersion }),
  });
}

async function requestHash(value: unknown): Promise<string> {
  try {
    const canonical = canonicalJson(value);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new AdminError("ADMIN_CONFIGURATION_ERROR", ERROR_MESSAGES.configuration, 500);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("not-json");
}

function withoutGeneratedId<T extends { id: string }>(record: T): Omit<T, "id"> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "id")) as Omit<T, "id">;
}

async function findOrThrow<T>(loader: () => Promise<T | null>): Promise<T> {
  const record = await loader();
  if (!record) throw new AdminError("ADMIN_NOT_FOUND", ERROR_MESSAGES.notFound, 404);
  return record;
}

function validatePage(limit?: number): number | undefined {
  return limit === undefined ? undefined : safeInteger(limit, "limit", 1, 100);
}

export async function getAdminOverview(dependencies: AdminDependencies): Promise<AdminOverviewRecord> {
  await authorize(dependencies);
  const instant = now(dependencies);
  return dto(await dependencies.repositories.overview.get(instant.iso));
}

export async function listAdminStock(
  dependencies: AdminDependencies,
  filters: StockFilters = {},
): Promise<AdminVehicleRecord[]> {
  await authorize(dependencies);
  return dto(
    await dependencies.repositories.stock.list({
      ...filters,
      query: filters.query?.trim() || undefined,
      limit: validatePage(filters.limit),
    }),
  );
}

export async function getAdminVehicle(
  dependencies: AdminDependencies,
  id: string,
): Promise<AdminVehicleRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.stock.findById(safeId)));
}

export interface CreateVehicleInput {
  idempotencyKey: string;
  slug: string;
  externalCode?: string | null;
  make: string;
  model: string;
  trim: string;
  year: number;
  mileageKm: number;
  priceCents: number;
  currency: VehicleCurrency;
  priceValidUntil?: string | null;
  bodyType: string;
  fuelType: string;
  transmission: string;
  color: string;
  source: string;
  internalNotes?: string | null;
  isDemo?: boolean;
}

function normalizedVehicle(
  dependencies: AdminDependencies,
  input: CreateVehicleInput,
): Omit<AdminVehicleRecord, "version" | "publishedAt" | "createdAt" | "updatedAt"> {
  const { date } = now(dependencies);
  const slug = requiredString(input.slug, "slug", 120).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid({ slug: "Debe ser un slug válido." });
  return {
    id: makeId(dependencies),
    slug,
    externalCode: optionalString(input.externalCode, "externalCode", 100),
    make: requiredString(input.make, "make", 80),
    model: requiredString(input.model, "model", 100),
    trim: requiredString(input.trim, "trim", 120),
    year: safeInteger(input.year, "year", 1900, date.getUTCFullYear() + 1),
    mileageKm: safeInteger(input.mileageKm, "mileageKm", 0, 5_000_000),
    priceCents: ars(input.priceCents, "priceCents"),
    currency: vehicleCurrency(input.currency),
    priceValidUntil: input.priceValidUntil ? isoDate(input.priceValidUntil, "priceValidUntil") : null,
    bodyType: requiredString(input.bodyType, "bodyType", 80),
    fuelType: requiredString(input.fuelType, "fuelType", 80),
    transmission: requiredString(input.transmission, "transmission", 80),
    color: requiredString(input.color, "color", 80),
    status: "DRAFT",
    source: requiredString(input.source, "source", 100),
    internalNotes: optionalString(input.internalNotes, "internalNotes", 2_000),
    isDemo: input.isDemo === true,
  };
}

export async function createAdminVehicle(
  dependencies: AdminDependencies,
  input: CreateVehicleInput,
): Promise<AdminVehicleRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const key = idempotencyKey(input.idempotencyKey);
  const record = normalizedVehicle(dependencies, input);
  const audit = makeAudit(dependencies, "VEHICLE", record.id, "VEHICLE_CREATED", null, instant.iso, {
    status: "DRAFT",
    source: record.source,
    isDemo: record.isDemo,
  });
  return resolveMutation(
    await dependencies.repositories.stock.create(record, key, {
      actor,
      audit,
      requestHash: await requestHash(withoutGeneratedId(record)),
    }),
  );
}

export type EditableVehiclePatch = Partial<
  Pick<
    AdminVehicleRecord,
    | "slug"
    | "externalCode"
    | "make"
    | "model"
    | "trim"
    | "year"
    | "mileageKm"
    | "priceCents"
    | "currency"
    | "priceValidUntil"
    | "bodyType"
    | "fuelType"
    | "transmission"
    | "color"
    | "source"
    | "internalNotes"
    | "isDemo"
  >
>;

function normalizeVehiclePatch(
  dependencies: AdminDependencies,
  patch: EditableVehiclePatch,
): EditableVehiclePatch {
  const output: EditableVehiclePatch = {};
  if (patch.slug !== undefined) {
    const slug = requiredString(patch.slug, "slug", 120).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid({ slug: "Debe ser un slug válido." });
    output.slug = slug;
  }
  if (patch.externalCode !== undefined) output.externalCode = optionalString(patch.externalCode, "externalCode", 100);
  if (patch.make !== undefined) output.make = requiredString(patch.make, "make", 80);
  if (patch.model !== undefined) output.model = requiredString(patch.model, "model", 100);
  if (patch.trim !== undefined) output.trim = requiredString(patch.trim, "trim", 120);
  if (patch.year !== undefined) output.year = safeInteger(patch.year, "year", 1900, now(dependencies).date.getUTCFullYear() + 1);
  if (patch.mileageKm !== undefined) output.mileageKm = safeInteger(patch.mileageKm, "mileageKm", 0, 5_000_000);
  if (patch.priceCents !== undefined) output.priceCents = ars(patch.priceCents, "priceCents");
  if (patch.currency !== undefined) output.currency = vehicleCurrency(patch.currency);
  if (patch.priceValidUntil !== undefined) output.priceValidUntil = patch.priceValidUntil ? isoDate(patch.priceValidUntil, "priceValidUntil") : null;
  for (const key of ["bodyType", "fuelType", "transmission", "color", "source"] as const) {
    if (patch[key] !== undefined) output[key] = requiredString(patch[key], key, 100);
  }
  if (patch.internalNotes !== undefined) output.internalNotes = optionalString(patch.internalNotes, "internalNotes", 2_000);
  if (patch.isDemo !== undefined) output.isDemo = patch.isDemo === true;
  if (Object.keys(output).length === 0) invalid({ patch: "Debe contener al menos un cambio." });
  return output;
}

export async function editAdminVehicle(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number; patch: EditableVehiclePatch },
): Promise<AdminVehicleRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const patch = normalizeVehiclePatch(dependencies, input.patch);
  const audit = makeAudit(dependencies, "VEHICLE", id, "VEHICLE_EDITED", expectedVersion, instant.iso, {
    changedFields: Object.keys(patch).sort().join(","),
  });
  return resolveMutation(
    await dependencies.repositories.stock.update({ id, expectedVersion, patch, actor, audit }),
  );
}

const VEHICLE_TRANSITIONS: Readonly<Record<VehicleStatus, readonly VehicleStatus[]>> = {
  DRAFT: ["AVAILABLE"],
  AVAILABLE: ["RESERVED", "SOLD", "PAUSED"],
  RESERVED: ["ARCHIVED"],
  SOLD: ["ARCHIVED"],
  PAUSED: ["ARCHIVED"],
  ARCHIVED: [],
};

function assertPublishableVehicle(record: AdminVehicleRecord, at: Date): void {
  const missing: string[] = [];
  if (!record.make) missing.push("make");
  if (!record.model) missing.push("model");
  if (!record.trim) missing.push("trim");
  if (!Number.isSafeInteger(record.year)) missing.push("year");
  if (!Number.isSafeInteger(record.mileageKm)) missing.push("mileageKm");
  if (!Number.isSafeInteger(record.priceCents) || record.priceCents <= 0) missing.push("priceCents");
  if (record.currency !== "ARS" && record.currency !== "USD") missing.push("currency");
  if (!record.bodyType || !record.fuelType || !record.transmission) missing.push("basicDetails");
  if (record.priceValidUntil && new Date(record.priceValidUntil).getTime() <= at.getTime()) missing.push("priceValidUntil");
  if (missing.length > 0) invalid({ vehicle: `Faltan datos publicables: ${missing.join(", ")}.` });
}

export async function transitionAdminVehicle(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number; nextStatus: VehicleStatus },
): Promise<AdminVehicleRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.stock.findById(id));
  if (!VEHICLE_TRANSITIONS[record.status].includes(input.nextStatus)) {
    invalidTransition(record.status, input.nextStatus);
  }
  if (input.nextStatus === "AVAILABLE") assertPublishableVehicle(record, instant.date);
  const action = input.nextStatus === "AVAILABLE" ? "VEHICLE_PUBLISHED" : `VEHICLE_${input.nextStatus}`;
  const audit = makeAudit(dependencies, "VEHICLE", id, action, expectedVersion, instant.iso, {
    from: record.status,
    to: input.nextStatus,
  });
  if (input.nextStatus === "ARCHIVED") {
    return resolveMutation(
      await dependencies.repositories.stock.archive({ id, expectedVersion, actor, audit }),
    );
  }
  return resolveMutation(
    await dependencies.repositories.stock.update({
      id,
      expectedVersion,
      patch: {
        status: input.nextStatus,
        ...(input.nextStatus === "AVAILABLE" ? { publishedAt: instant.iso } : {}),
      },
      actor,
      audit,
    }),
  );
}

export async function listAdminLeads(
  dependencies: AdminDependencies,
  filters: LeadFilters = {},
): Promise<AdminLeadRecord[]> {
  await authorize(dependencies);
  return dto(await dependencies.repositories.leads.list({ ...filters, limit: validatePage(filters.limit) }));
}

export async function getAdminLead(dependencies: AdminDependencies, id: string): Promise<AdminLeadRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.leads.findById(safeId)));
}

const LEAD_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  NEW: ["CONTACTED"],
  CONTACTED: ["QUALIFIED"],
  QUALIFIED: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

export async function transitionAdminLead(
  dependencies: AdminDependencies,
  input: {
    id: string;
    expectedVersion: number;
    nextStatus: LeadStatus;
    assignedTo?: string;
    lostReason?: string;
  },
): Promise<AdminLeadRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.leads.findById(id));
  if (!LEAD_TRANSITIONS[record.status].includes(input.nextStatus)) {
    invalidTransition(record.status, input.nextStatus);
  }
  const assignedTo = input.assignedTo === undefined ? undefined : requiredString(input.assignedTo, "assignedTo", 200);
  const lostReason = input.nextStatus === "LOST" ? requiredString(input.lostReason, "lostReason", 500) : undefined;
  const audit = makeAudit(dependencies, "LEAD", id, "LEAD_STATUS_CHANGED", expectedVersion, instant.iso, {
    from: record.status,
    to: input.nextStatus,
    assignmentChanged: assignedTo !== undefined,
    hasLostReason: lostReason !== undefined,
  });
  return resolveMutation(
    await dependencies.repositories.leads.transition({
      id,
      expectedVersion,
      nextStatus: input.nextStatus,
      ...(assignedTo ? { assignedTo } : {}),
      ...(lostReason ? { lostReason } : {}),
      actor,
      audit,
    }),
  );
}

export async function listAdminAppraisals(
  dependencies: AdminDependencies,
  filters: AppraisalFilters = {},
): Promise<AdminAppraisalRecord[]> {
  await authorize(dependencies);
  return dto(await dependencies.repositories.appraisals.list({ ...filters, limit: validatePage(filters.limit) }));
}

export async function getAdminAppraisal(
  dependencies: AdminDependencies,
  id: string,
): Promise<AdminAppraisalRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.appraisals.findById(safeId)));
}

const APPRAISAL_TRANSITIONS: Readonly<Record<AppraisalStatus, readonly AppraisalStatus[]>> = {
  SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: ["ESTIMATED"],
  ESTIMATED: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

export interface ReviewAppraisalInput {
  id: string;
  expectedVersion: number;
  nextStatus: AppraisalStatus;
  lowCents?: number;
  baseCents?: number;
  highCents?: number;
  currency?: unknown;
  certaintyLevel?: CertaintyLevel;
  validUntil?: string;
  notes?: string;
}

export async function reviewAdminAppraisal(
  dependencies: AdminDependencies,
  input: ReviewAppraisalInput,
): Promise<AdminAppraisalRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.appraisals.findById(id));
  if (!APPRAISAL_TRANSITIONS[record.status].includes(input.nextStatus)) {
    invalidTransition(record.status, input.nextStatus);
  }
  const payload: Parameters<AppraisalRepository["review"]>[0] = {
    id,
    expectedVersion,
    status: input.nextStatus,
    actor,
    audit: undefined as never,
  };
  if (input.nextStatus === "ESTIMATED") {
    const lowCents = ars(input.lowCents, "lowCents", false);
    const baseCents = ars(input.baseCents, "baseCents", false);
    const highCents = ars(input.highCents, "highCents", false);
    if (!(lowCents <= baseCents && baseCents <= highCents)) {
      invalid({ appraisalRange: "Debe cumplir lowCents ≤ baseCents ≤ highCents." });
    }
    if (!(["T0", "T1"] as const).includes(input.certaintyLevel as CertaintyLevel)) {
      invalid({ certaintyLevel: "Debe ser T0 o T1." });
    }
    const validUntil = isoDate(input.validUntil, "validUntil");
    if (new Date(validUntil).getTime() <= instant.date.getTime()) {
      invalid({ validUntil: "Debe ser posterior al momento actual." });
    }
    Object.assign(payload, {
      lowCents,
      baseCents,
      highCents,
      currency: currency(input.currency),
      certaintyLevel: input.certaintyLevel,
      validUntil,
    });
  }
  if (input.nextStatus === "EXPIRED") {
    if (!record.validUntil || new Date(record.validUntil).getTime() > instant.date.getTime()) {
      invalid({ nextStatus: "La tasación todavía está vigente." });
    }
  }
  if (input.notes !== undefined) payload.notes = requiredString(input.notes, "notes", 2_000);
  payload.audit = makeAudit(
    dependencies,
    "APPRAISAL",
    id,
    "APPRAISAL_STATUS_CHANGED",
    expectedVersion,
    instant.iso,
    { from: record.status, to: input.nextStatus, hasNotes: input.notes !== undefined },
  );
  return resolveMutation(await dependencies.repositories.appraisals.review(payload));
}

export async function listAdminConsignments(
  dependencies: AdminDependencies,
  filters: ConsignmentFilters = {},
): Promise<AdminConsignmentRecord[]> {
  await authorize(dependencies);
  return dto(await dependencies.repositories.consignments.list({ ...filters, limit: validatePage(filters.limit) }));
}

export async function getAdminConsignment(
  dependencies: AdminDependencies,
  id: string,
): Promise<AdminConsignmentRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.consignments.findById(safeId)));
}

const CONSIGNMENT_TRANSITIONS: Readonly<Record<ConsignmentStatus, readonly ConsignmentStatus[]>> = {
  SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
};

// Debe coincidir con CONSIGNMENT_CAPTURE_TYPES de la capa de datos; se
// duplica para mantener este módulo libre de dependencias de infraestructura.
const CONSIGNMENT_REQUIRED_READY_PHOTOS = 5;

export interface ReviewConsignmentInput {
  id: string;
  expectedVersion: number;
  nextStatus: ConsignmentStatus;
  notes?: string;
}

export async function reviewAdminConsignment(
  dependencies: AdminDependencies,
  input: ReviewConsignmentInput,
): Promise<AdminConsignmentRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.consignments.findById(id));
  if (!CONSIGNMENT_TRANSITIONS[record.status].includes(input.nextStatus)) {
    invalidTransition(record.status, input.nextStatus);
  }
  // El servidor, no sólo la UI, exige las cinco capturas confirmadas antes de
  // abrir la revisión: una consignación sin fotos completas no pasa a IN_REVIEW.
  if (input.nextStatus === "IN_REVIEW") {
    const readyPhotos = await dependencies.repositories.consignments.countReadyMedia(id);
    if (readyPhotos !== CONSIGNMENT_REQUIRED_READY_PHOTOS) {
      throw new AdminError("ADMIN_INVALID_TRANSITION", ERROR_MESSAGES.transition, 409, {
        current: record.status,
        next: input.nextStatus,
        readyPhotos,
        requiredPhotos: CONSIGNMENT_REQUIRED_READY_PHOTOS,
      });
    }
  }
  const notes = input.notes !== undefined ? requiredString(input.notes, "notes", 2_000) : undefined;
  const audit = makeAudit(
    dependencies,
    "CONSIGNMENT",
    id,
    "CONSIGNMENT_STATUS_CHANGED",
    expectedVersion,
    instant.iso,
    {
      from: record.status,
      to: input.nextStatus,
      hasNotes: notes !== undefined,
      // Accepting enables the offer; stock publication stays a separate
      // manual circuit so this never counts as a listing by itself.
      publishesStock: false,
    },
  );
  return resolveMutation(
    await dependencies.repositories.consignments.review({
      id,
      expectedVersion,
      status: input.nextStatus,
      ...(notes !== undefined ? { notes } : {}),
      actor,
      audit,
    }),
  );
}

export async function listFinanceVersions(
  dependencies: AdminDependencies,
): Promise<FinanceVersionRecord[]> {
  await authorize(dependencies);
  return dto(await dependencies.repositories.finance.listVersions());
}

export async function getFinanceVersion(
  dependencies: AdminDependencies,
  id: string,
): Promise<FinanceVersionRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.finance.findById(safeId)));
}

export interface CreateFinanceVersionInput {
  idempotencyKey: string;
  version: string;
  name: string;
  provider: string;
  currency: "ARS";
  pricingKind: FinancePricingKind;
  monthlyRateBps?: number | null;
  installmentCoefficientPpm?: number | null;
  maxFinanceRatioBps: number;
  minimumDownPaymentRatioBps: number;
  allowedVehicleTypes: string[];
  maxVehicleAgeYears: number;
  requiresPromotionId?: string | null;
  comfortablePaymentMarginBps: number;
  validFrom: string;
  validUntil: string;
  disclaimer: string;
  tiers: Array<Omit<FinanceTierRecord, "id"> & { id?: string }>;
  isDemo?: boolean;
}

function normalizeFinanceTiers(
  dependencies: AdminDependencies,
  tiers: CreateFinanceVersionInput["tiers"],
): FinanceTierRecord[] {
  if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 100) {
    invalid({ tiers: "Debe incluir entre 1 y 100 tramos." });
  }
  const normalized = tiers.map((tier, index) => {
    const minAmountCents = ars(tier.minAmountCents, `tiers.${index}.minAmountCents`);
    const maxAmountCents = ars(tier.maxAmountCents, `tiers.${index}.maxAmountCents`, false);
    if (minAmountCents > maxAmountCents) invalid({ [`tiers.${index}`]: "El mínimo supera al máximo." });
    return {
      id: tier.id ? requiredString(tier.id, `tiers.${index}.id`) : makeId(dependencies),
      minAmountCents,
      maxAmountCents,
      termMonths: safeInteger(tier.termMonths, `tiers.${index}.termMonths`, 1, 120),
      installmentCoefficientPpm:
        tier.installmentCoefficientPpm === null
          ? null
          : safeInteger(
              tier.installmentCoefficientPpm,
              `tiers.${index}.installmentCoefficientPpm`,
              1,
              10_000_000,
            ),
      sortOrder: safeInteger(tier.sortOrder, `tiers.${index}.sortOrder`, 0, 10_000),
    };
  });
  const byTerm = new Map<number, FinanceTierRecord[]>();
  for (const tier of normalized) byTerm.set(tier.termMonths, [...(byTerm.get(tier.termMonths) ?? []), tier]);
  for (const group of byTerm.values()) {
    group.sort((left, right) => left.minAmountCents - right.minAmountCents);
    for (let index = 1; index < group.length; index += 1) {
      if (group[index].minAmountCents <= group[index - 1].maxAmountCents) {
        invalid({ tiers: "Hay tramos superpuestos para el mismo plazo." });
      }
    }
  }
  return normalized;
}

export async function createFinanceVersion(
  dependencies: AdminDependencies,
  input: CreateFinanceVersionInput,
): Promise<FinanceVersionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const key = idempotencyKey(input.idempotencyKey);
  const validFrom = isoDate(input.validFrom, "validFrom");
  const validUntil = isoDate(input.validUntil, "validUntil");
  if (new Date(validFrom).getTime() >= new Date(validUntil).getTime()) {
    invalid({ validity: "validFrom debe ser anterior a validUntil." });
  }
  if (!(input.pricingKind === "french" || input.pricingKind === "coefficient" || input.pricingKind === "table")) {
    invalid({ pricingKind: "Debe ser french, coefficient o table." });
  }
  const monthlyRateBps =
    input.monthlyRateBps === null || input.monthlyRateBps === undefined
      ? null
      : safeInteger(input.monthlyRateBps, "monthlyRateBps", 0, 1_000_000);
  const installmentCoefficientPpm =
    input.installmentCoefficientPpm === null || input.installmentCoefficientPpm === undefined
      ? null
      : safeInteger(input.installmentCoefficientPpm, "installmentCoefficientPpm", 1, 10_000_000);
  if (input.pricingKind === "french" && monthlyRateBps === null) {
    invalid({ monthlyRateBps: "Es obligatorio para pricingKind french." });
  }
  if (input.pricingKind === "coefficient" && installmentCoefficientPpm === null) {
    invalid({ installmentCoefficientPpm: "Es obligatorio para pricingKind coefficient." });
  }
  if (input.pricingKind === "table" && (monthlyRateBps !== null || installmentCoefficientPpm !== null)) {
    invalid({ pricingKind: "La modalidad table define coeficientes únicamente por tramo." });
  }
  if (!Array.isArray(input.allowedVehicleTypes) || input.allowedVehicleTypes.length === 0) {
    invalid({ allowedVehicleTypes: "Debe incluir al menos un tipo de vehículo." });
  }
  const allowedVehicleTypes = [
    ...new Set(input.allowedVehicleTypes.map((item, index) => requiredString(item, `allowedVehicleTypes.${index}`, 80))),
  ];
  const tiers = normalizeFinanceTiers(dependencies, input.tiers);
  if (
    input.pricingKind === "table" &&
    tiers.some((tier) => tier.installmentCoefficientPpm === null)
  ) {
    invalid({ tiers: "Cada tramo table requiere installmentCoefficientPpm." });
  }
  if (
    input.pricingKind !== "table" &&
    tiers.some((tier) => tier.installmentCoefficientPpm !== null)
  ) {
    invalid({ tiers: "Los coeficientes por tramo se admiten únicamente en pricingKind table." });
  }
  const record: Omit<FinanceVersionRecord, "lockVersion" | "publishedAt" | "createdAt" | "updatedAt"> = {
    id: makeId(dependencies),
    version: requiredString(input.version, "version", 80),
    name: requiredString(input.name, "name", 160),
    provider: requiredString(input.provider, "provider", 160),
    currency: currency(input.currency),
    status: "DRAFT",
    pricingKind: input.pricingKind,
    monthlyRateBps,
    installmentCoefficientPpm,
    maxFinanceRatioBps: safeInteger(input.maxFinanceRatioBps, "maxFinanceRatioBps", 0, 10_000),
    minimumDownPaymentRatioBps: safeInteger(
      input.minimumDownPaymentRatioBps,
      "minimumDownPaymentRatioBps",
      0,
      10_000,
    ),
    allowedVehicleTypes,
    maxVehicleAgeYears: safeInteger(input.maxVehicleAgeYears, "maxVehicleAgeYears", 0, 100),
    requiresPromotionId: optionalString(input.requiresPromotionId, "requiresPromotionId", 200),
    comfortablePaymentMarginBps: safeInteger(
      input.comfortablePaymentMarginBps,
      "comfortablePaymentMarginBps",
      0,
      10_000,
    ),
    validFrom,
    validUntil,
    disclaimer: requiredString(input.disclaimer, "disclaimer", 2_000),
    tiers,
    isDemo: input.isDemo === true,
  };
  const audit = makeAudit(dependencies, "FINANCE_VERSION", record.id, "FINANCE_VERSION_CREATED", null, instant.iso, {
    commercialVersion: record.version,
    tierCount: record.tiers.length,
    isDemo: record.isDemo,
  });
  return resolveMutation(
    await dependencies.repositories.finance.createVersion(record, key, {
      actor,
      audit,
      requestHash: await requestHash(withoutGeneratedId(record)),
    }),
  );
}

export async function transitionFinanceVersion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number; nextStatus: "PUBLISHED" | "RETIRED" },
): Promise<FinanceVersionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.finance.findById(id));
  const allowed =
    (record.status === "DRAFT" && input.nextStatus === "PUBLISHED") ||
    (record.status === "PUBLISHED" && input.nextStatus === "RETIRED");
  if (!allowed) invalidTransition(record.status, input.nextStatus);
  if (input.nextStatus === "PUBLISHED") {
    if (record.tiers.length === 0) invalid({ tiers: "Debe incluir al menos un tramo." });
    if (new Date(record.validUntil).getTime() <= instant.date.getTime()) invalid({ validUntil: "El tarifario ya venció." });
  }
  const audit = makeAudit(dependencies, "FINANCE_VERSION", id, "FINANCE_STATUS_CHANGED", expectedVersion, instant.iso, {
    from: record.status,
    to: input.nextStatus,
    commercialVersion: record.version,
  });
  return resolveMutation(
    await dependencies.repositories.finance.setStatus({
      id,
      expectedVersion,
      nextStatus: input.nextStatus,
      actor,
      audit,
    }),
  );
}

export async function listAdminPromotions(
  dependencies: AdminDependencies,
  filters: PromotionFilters = {},
): Promise<AdminPromotionRecord[]> {
  await authorize(dependencies);
  return dto(await dependencies.repositories.promotions.list({ ...filters, limit: validatePage(filters.limit) }));
}

export async function getAdminPromotion(
  dependencies: AdminDependencies,
  id: string,
): Promise<AdminPromotionRecord> {
  await authorize(dependencies);
  const safeId = requiredString(id, "id");
  return dto(await findOrThrow(() => dependencies.repositories.promotions.findById(safeId)));
}

export interface CreatePromotionInput {
  idempotencyKey: string;
  slug: string;
  publicCode: string;
  title: string;
  description: string;
  type: string;
  vehicleIds: string[];
  startsAt: string;
  endsAt: string;
  discountCents: number;
  tradeInBonusCents: number;
  financePlanVersionId?: string | null;
  stackable?: boolean;
  normalConditionsSnapshot: Readonly<Record<string, JsonValue>>;
  isDemo?: boolean;
}

function vehicleIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    invalid({ vehicleIds: "Debe incluir entre 1 y 100 unidades." });
  }
  return [...new Set(values.map((value, index) => requiredString(value, `vehicleIds.${index}`)))];
}

function conditions(value: unknown): Readonly<Record<string, JsonValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    invalid({ normalConditionsSnapshot: "Debe guardar explícitamente las condiciones normales comparadas." });
  }
  return dto(value as Record<string, JsonValue>);
}

export async function createAdminPromotion(
  dependencies: AdminDependencies,
  input: CreatePromotionInput,
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const key = idempotencyKey(input.idempotencyKey);
  const slug = requiredString(input.slug, "slug", 120).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid({ slug: "Debe ser un slug válido." });
  const startsAt = isoDate(input.startsAt, "startsAt");
  const endsAt = isoDate(input.endsAt, "endsAt");
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    invalid({ validity: "startsAt debe ser anterior a endsAt." });
  }
  if (new Date(endsAt).getTime() <= instant.date.getTime()) {
    invalid({ endsAt: "La oferta debe finalizar en el futuro." });
  }
  const record: Omit<AdminPromotionRecord, "version" | "createdAt" | "updatedAt"> = {
    id: makeId(dependencies),
    slug,
    publicCode: requiredString(input.publicCode, "publicCode", 80),
    title: requiredString(input.title, "title", 160),
    description: requiredString(input.description, "description", 1_000),
    type: requiredString(input.type, "type", 80),
    status: "DRAFT",
    vehicleIds: vehicleIds(input.vehicleIds),
    startsAt,
    endsAt,
    discountCents: ars(input.discountCents, "discountCents"),
    tradeInBonusCents: ars(input.tradeInBonusCents, "tradeInBonusCents"),
    financePlanVersionId: optionalString(input.financePlanVersionId, "financePlanVersionId", 200),
    stackable: input.stackable === true,
    normalConditionsSnapshot: conditions(input.normalConditionsSnapshot),
    isDemo: input.isDemo === true,
  };
  const audit = makeAudit(dependencies, "PROMOTION", record.id, "PROMOTION_CREATED", null, instant.iso, {
    vehicleCount: record.vehicleIds.length,
    isDemo: record.isDemo,
  });
  return resolveMutation(
    await dependencies.repositories.promotions.create(record, key, {
      actor,
      audit,
      requestHash: await requestHash(withoutGeneratedId(record)),
    }),
  );
}

async function assertAvailableVehicles(dependencies: AdminDependencies, ids: string[]): Promise<void> {
  const records = await Promise.all(ids.map((id) => dependencies.repositories.stock.findById(id)));
  const unavailable = records
    .map((record, index) => (!record || record.status !== "AVAILABLE" ? ids[index] : null))
    .filter((id): id is string => id !== null);
  if (unavailable.length > 0) invalid({ vehicleIds: "La oferta requiere unidades disponibles." });
}

export async function scheduleAdminPromotion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number; startsAt: string; endsAt: string },
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.promotions.findById(id));
  if (record.status !== "DRAFT") invalidTransition(record.status, "SCHEDULED");
  const startsAt = isoDate(input.startsAt, "startsAt");
  const endsAt = isoDate(input.endsAt, "endsAt");
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) invalid({ validity: "startsAt debe ser anterior a endsAt." });
  if (new Date(endsAt).getTime() <= instant.date.getTime()) invalid({ endsAt: "La oferta debe finalizar en el futuro." });
  vehicleIds(record.vehicleIds);
  conditions(record.normalConditionsSnapshot);
  const audit = makeAudit(dependencies, "PROMOTION", id, "PROMOTION_SCHEDULED", expectedVersion, instant.iso, {
    from: record.status,
    to: "SCHEDULED",
    startsAt,
    endsAt,
  });
  return resolveMutation(
    await dependencies.repositories.promotions.schedule({
      id,
      expectedVersion,
      nextStatus: "SCHEDULED",
      startsAt,
      endsAt,
      actor,
      audit,
    }),
  );
}

export async function activateAdminPromotion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number },
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.promotions.findById(id));
  if (record.status !== "SCHEDULED") invalidTransition(record.status, "ACTIVE");
  if (!record.startsAt || !record.endsAt) invalid({ validity: "La oferta no tiene una ventana programada." });
  const startsAt = new Date(record.startsAt).getTime();
  const endsAt = new Date(record.endsAt).getTime();
  if (instant.date.getTime() < startsAt || instant.date.getTime() >= endsAt) {
    invalid({ validity: "La oferta está fuera de su ventana de vigencia." });
  }
  conditions(record.normalConditionsSnapshot);
  await assertAvailableVehicles(dependencies, vehicleIds(record.vehicleIds));
  const audit = makeAudit(dependencies, "PROMOTION", id, "PROMOTION_ACTIVATED", expectedVersion, instant.iso, {
    from: record.status,
    to: "ACTIVE",
    vehicleCount: record.vehicleIds.length,
  });
  return resolveMutation(
    await dependencies.repositories.promotions.setStatus({
      id,
      expectedVersion,
      nextStatus: "ACTIVE",
      actor,
      audit,
    }),
  );
}

export async function pauseAdminPromotion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number },
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.promotions.findById(id));
  if (record.status !== "ACTIVE") invalidTransition(record.status, "PAUSED");
  const audit = makeAudit(dependencies, "PROMOTION", id, "PROMOTION_PAUSED", expectedVersion, instant.iso, {
    from: record.status,
    to: "PAUSED",
  });
  return resolveMutation(
    await dependencies.repositories.promotions.setStatus({
      id,
      expectedVersion,
      nextStatus: "PAUSED",
      actor,
      audit,
    }),
  );
}

export async function expireAdminPromotion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number },
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.promotions.findById(id));
  if (record.status !== "ACTIVE") invalidTransition(record.status, "EXPIRED");
  if (new Date(record.endsAt).getTime() > instant.date.getTime()) {
    invalid({ nextStatus: "La oferta todavía está vigente." });
  }
  const audit = makeAudit(dependencies, "PROMOTION", id, "PROMOTION_EXPIRED", expectedVersion, instant.iso, {
    from: record.status,
    to: "EXPIRED",
  });
  return resolveMutation(
    await dependencies.repositories.promotions.setStatus({
      id,
      expectedVersion,
      nextStatus: "EXPIRED",
      actor,
      audit,
    }),
  );
}

export async function archiveAdminPromotion(
  dependencies: AdminDependencies,
  input: { id: string; expectedVersion: number },
): Promise<AdminPromotionRecord> {
  const actor = await authorize(dependencies);
  const instant = now(dependencies);
  const id = requiredString(input.id, "id");
  const expectedVersion = version(input.expectedVersion);
  const record = await findOrThrow(() => dependencies.repositories.promotions.findById(id));
  if (record.status !== "ACTIVE") invalidTransition(record.status, "ARCHIVED");
  const audit = makeAudit(dependencies, "PROMOTION", id, "PROMOTION_ARCHIVED", expectedVersion, instant.iso, {
    from: record.status,
    to: "ARCHIVED",
  });
  return resolveMutation(
    await dependencies.repositories.promotions.setStatus({
      id,
      expectedVersion,
      nextStatus: "ARCHIVED",
      actor,
      audit,
    }),
  );
}
