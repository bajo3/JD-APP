import { getD1Binding } from "@/db";

export type CustomerAccountRecord = Readonly<{
  id: string;
  email: string;
  name: string;
  phoneNormalized: string | null;
  leadId: string | null;
  status: string;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  version: number;
  createdAt: string;
}>;

export type StoredPassword = Readonly<{
  algorithm: string;
  hash: string;
  salt: string;
  iterations: number;
}>;

export type CustomerPreferenceRecord = Readonly<{
  budgetCents: number | null;
  maxMonthlyPaymentCents: number | null;
  currency: string;
  preferredMakes: readonly string[];
  preferredBodyTypes: readonly string[];
  currentVehicle: Readonly<Record<string, unknown>> | null;
  version: number;
  updatedAt: string | null;
}>;

export type CustomerFavoriteRecord = Readonly<{
  id: string;
  vehicleId: string;
  slug: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  mileageKm: number;
  priceCents: number;
  currency: string;
  status: string;
  createdAt: string;
}>;

export type CustomerSavedSearchRecord = Readonly<{
  id: string;
  name: string;
  query: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type CustomerActivityRecord = Readonly<{
  appraisals: readonly Readonly<{
    publicCode: string;
    vehicleDescription: string;
    status: string;
    lowCents: number | null;
    baseCents: number | null;
    highCents: number | null;
    currency: string;
    createdAt: string;
  }>[];
  simulations: readonly Readonly<{
    publicCode: string;
    status: string;
    classification: string;
    vehicleName: string | null;
    vehicleSlug: string | null;
    effectivePriceCents: number;
    installmentCents: number | null;
    termMonths: number | null;
    currency: string;
    expiresAt: string;
    createdAt: string;
  }>[];
}>;

export type CreateAccountInput = Readonly<{
  accountId: string;
  email: string;
  name: string;
  phoneNormalized: string | null;
  password: StoredPassword;
  leadId: string | null;
  occurredAt: string;
}>;

export type CreateAccountResult =
  | { ok: true; record: CustomerAccountRecord }
  | { ok: false; reason: "email_taken" };

type AccountSqlRow = {
  id: string;
  email: string;
  name: string;
  phone_normalized: string | null;
  lead_id: string | null;
  status: string;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  version: number;
  created_at: string;
};

type AccountWithSecretRow = AccountSqlRow & {
  password_algorithm: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

function accountFromRow(row: AccountSqlRow): CustomerAccountRecord {
  return Object.freeze({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    phoneNormalized: row.phone_normalized === null ? null : String(row.phone_normalized),
    leadId: row.lead_id === null ? null : String(row.lead_id),
    status: String(row.status),
    failedAttempts: Number(row.failed_attempts),
    lockedUntil: row.locked_until === null ? null : String(row.locked_until),
    lastLoginAt: row.last_login_at === null ? null : String(row.last_login_at),
    version: Number(row.version),
    createdAt: String(row.created_at),
  });
}

function parseJsonArray(value: unknown): readonly string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ACCOUNT_COLUMNS = `id, email, name, phone_normalized, lead_id, status,
  failed_attempts, locked_until, last_login_at, version, created_at`;

export type CustomerAccountRepositoryLike = Pick<
  D1CustomerAccountRepository,
  | "create"
  | "findByEmail"
  | "findById"
  | "findSessionAccount"
  | "openSession"
  | "revokeSession"
  | "registerFailedAttempt"
  | "registerSuccessfulLogin"
  | "updateProfile"
  | "updatePassword"
  | "readPreferences"
  | "savePreferences"
  | "listFavorites"
  | "addFavorite"
  | "removeFavorite"
  | "listSavedSearches"
  | "saveSearch"
  | "removeSavedSearch"
  | "readActivity"
>;

/**
 * Persistencia de la cuenta del cliente.
 *
 * La contraseña sólo sale de la base por `findByEmail`, que es el único camino
 * que la necesita para verificar; el resto de las lecturas devuelve la cuenta
 * sin el material secreto. No hay borrado físico: cerrar sesión revoca, y dar
 * de baja marca la cuenta.
 */
export class D1CustomerAccountRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async create(input: CreateAccountInput): Promise<CreateAccountResult> {
    const taken = await this.d1
      .prepare("SELECT id FROM customer_account WHERE email = ? LIMIT 1")
      .bind(input.email)
      .first<{ id: string }>();
    if (taken) return { ok: false, reason: "email_taken" };

    try {
      await this.d1.batch([
        this.d1
          .prepare(
            `INSERT INTO customer_account
             (id, email, password_algorithm, password_hash, password_salt,
              password_iterations, name, phone_normalized, lead_id, status,
              failed_attempts, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 1, ?, ?)`,
          )
          .bind(
            input.accountId,
            input.email,
            input.password.algorithm,
            input.password.hash,
            input.password.salt,
            input.password.iterations,
            input.name,
            input.phoneNormalized,
            input.leadId,
            input.occurredAt,
            input.occurredAt,
          ),
        this.d1
          .prepare(
            `INSERT INTO customer_preference
             (account_id, currency, preferred_makes_json, preferred_body_types_json,
              version, created_at, updated_at)
             VALUES (?, 'ARS', '[]', '[]', 1, ?, ?)`,
          )
          .bind(input.accountId, input.occurredAt, input.occurredAt),
      ]);
    } catch (error) {
      // El índice único es la última palabra ante dos altas simultáneas.
      if (String(error).includes("UNIQUE")) return { ok: false, reason: "email_taken" };
      throw error;
    }

    const record = await this.findById(input.accountId);
    if (!record) throw new Error("customer_account_create_readback_failed");
    return { ok: true, record };
  }

  async findByEmail(
    email: string,
  ): Promise<{ account: CustomerAccountRecord; password: StoredPassword } | null> {
    const row = await this.d1
      .prepare(
        `SELECT ${ACCOUNT_COLUMNS}, password_algorithm, password_hash,
                password_salt, password_iterations
         FROM customer_account WHERE email = ? LIMIT 1`,
      )
      .bind(email)
      .first<AccountWithSecretRow>();
    if (!row) return null;
    return {
      account: accountFromRow(row),
      password: Object.freeze({
        algorithm: String(row.password_algorithm),
        hash: String(row.password_hash),
        salt: String(row.password_salt),
        iterations: Number(row.password_iterations),
      }),
    };
  }

  async findById(accountId: string): Promise<CustomerAccountRecord | null> {
    const row = await this.d1
      .prepare(`SELECT ${ACCOUNT_COLUMNS} FROM customer_account WHERE id = ? LIMIT 1`)
      .bind(accountId)
      .first<AccountSqlRow>();
    return row ? accountFromRow(row) : null;
  }

  /** Resuelve la sesión y la cuenta en una sola consulta. */
  async findSessionAccount(
    tokenHash: string,
    now: string,
  ): Promise<{ sessionId: string; account: CustomerAccountRecord } | null> {
    const row = await this.d1
      .prepare(
        `SELECT s.id AS session_id, ${ACCOUNT_COLUMNS.split(", ")
          .map((column) => `a.${column.trim()}`)
          .join(", ")}
         FROM customer_session s
         JOIN customer_account a ON a.id = s.account_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
           AND a.status = 'ACTIVE'
         LIMIT 1`,
      )
      .bind(tokenHash, now)
      .first<AccountSqlRow & { session_id: string }>();
    if (!row) return null;
    return { sessionId: String(row.session_id), account: accountFromRow(row) };
  }

  async openSession(input: {
    sessionId: string;
    accountId: string;
    tokenHash: string;
    expiresAt: string;
    occurredAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO customer_session
         (id, account_id, token_hash, expires_at, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.sessionId,
        input.accountId,
        input.tokenHash,
        input.expiresAt,
        input.occurredAt,
        input.occurredAt,
      )
      .run();
  }

  async revokeSession(tokenHash: string, occurredAt: string): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE customer_session SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(occurredAt, tokenHash)
      .run();
  }

  async registerFailedAttempt(input: {
    accountId: string;
    failedAttempts: number;
    lockedUntil: string | null;
    occurredAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE customer_account
         SET failed_attempts = ?, locked_until = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.failedAttempts, input.lockedUntil, input.occurredAt, input.accountId)
      .run();
  }

  /** Login exitoso: limpia el bloqueo y, si hace falta, guarda el rehash. */
  async registerSuccessfulLogin(input: {
    accountId: string;
    occurredAt: string;
    password?: StoredPassword;
  }): Promise<void> {
    if (input.password) {
      await this.d1
        .prepare(
          `UPDATE customer_account
           SET failed_attempts = 0, locked_until = NULL, last_login_at = ?,
               password_algorithm = ?, password_hash = ?, password_salt = ?,
               password_iterations = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.occurredAt,
          input.password.algorithm,
          input.password.hash,
          input.password.salt,
          input.password.iterations,
          input.occurredAt,
          input.accountId,
        )
        .run();
      return;
    }
    await this.d1
      .prepare(
        `UPDATE customer_account
         SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.occurredAt, input.occurredAt, input.accountId)
      .run();
  }

  async updateProfile(input: {
    accountId: string;
    name: string;
    phoneNormalized: string | null;
    occurredAt: string;
  }): Promise<CustomerAccountRecord | null> {
    await this.d1
      .prepare(
        `UPDATE customer_account
         SET name = ?, phone_normalized = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.name, input.phoneNormalized, input.occurredAt, input.accountId)
      .run();
    return this.findById(input.accountId);
  }

  /** Cambiar la contraseña revoca toda otra sesión abierta de esa cuenta. */
  async updatePassword(input: {
    accountId: string;
    password: StoredPassword;
    keepSessionId: string;
    occurredAt: string;
  }): Promise<void> {
    await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE customer_account
           SET password_algorithm = ?, password_hash = ?, password_salt = ?,
               password_iterations = ?, failed_attempts = 0, locked_until = NULL,
               version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.password.algorithm,
          input.password.hash,
          input.password.salt,
          input.password.iterations,
          input.occurredAt,
          input.accountId,
        ),
      this.d1
        .prepare(
          `UPDATE customer_session SET revoked_at = ?
           WHERE account_id = ? AND id <> ? AND revoked_at IS NULL`,
        )
        .bind(input.occurredAt, input.accountId, input.keepSessionId),
    ]);
  }

  async readPreferences(accountId: string): Promise<CustomerPreferenceRecord> {
    const row = await this.d1
      .prepare(
        `SELECT budget_cents, max_monthly_payment_cents, currency,
                preferred_makes_json, preferred_body_types_json,
                current_vehicle_json, version, updated_at
         FROM customer_preference WHERE account_id = ? LIMIT 1`,
      )
      .bind(accountId)
      .first<{
        budget_cents: number | null;
        max_monthly_payment_cents: number | null;
        currency: string;
        preferred_makes_json: string;
        preferred_body_types_json: string;
        current_vehicle_json: string | null;
        version: number;
        updated_at: string;
      }>();
    if (!row) {
      return Object.freeze({
        budgetCents: null,
        maxMonthlyPaymentCents: null,
        currency: "ARS",
        preferredMakes: [],
        preferredBodyTypes: [],
        currentVehicle: null,
        version: 1,
        updatedAt: null,
      });
    }
    return Object.freeze({
      budgetCents: row.budget_cents === null ? null : Number(row.budget_cents),
      maxMonthlyPaymentCents:
        row.max_monthly_payment_cents === null ? null : Number(row.max_monthly_payment_cents),
      currency: String(row.currency),
      preferredMakes: parseJsonArray(row.preferred_makes_json),
      preferredBodyTypes: parseJsonArray(row.preferred_body_types_json),
      currentVehicle: parseJsonObject(row.current_vehicle_json),
      version: Number(row.version),
      updatedAt: String(row.updated_at),
    });
  }

  async savePreferences(input: {
    accountId: string;
    budgetCents: number | null;
    maxMonthlyPaymentCents: number | null;
    preferredMakes: readonly string[];
    preferredBodyTypes: readonly string[];
    currentVehicle: Record<string, unknown> | null;
    occurredAt: string;
  }): Promise<CustomerPreferenceRecord> {
    await this.d1
      .prepare(
        `INSERT INTO customer_preference
         (account_id, budget_cents, max_monthly_payment_cents, currency,
          preferred_makes_json, preferred_body_types_json, current_vehicle_json,
          version, created_at, updated_at)
         VALUES (?, ?, ?, 'ARS', ?, ?, ?, 1, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           budget_cents = excluded.budget_cents,
           max_monthly_payment_cents = excluded.max_monthly_payment_cents,
           preferred_makes_json = excluded.preferred_makes_json,
           preferred_body_types_json = excluded.preferred_body_types_json,
           current_vehicle_json = excluded.current_vehicle_json,
           version = customer_preference.version + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.accountId,
        input.budgetCents,
        input.maxMonthlyPaymentCents,
        JSON.stringify(input.preferredMakes),
        JSON.stringify(input.preferredBodyTypes),
        input.currentVehicle === null ? null : JSON.stringify(input.currentVehicle),
        input.occurredAt,
        input.occurredAt,
      )
      .run();
    return this.readPreferences(input.accountId);
  }

  async listFavorites(accountId: string): Promise<readonly CustomerFavoriteRecord[]> {
    const result = await this.d1
      .prepare(
        `SELECT f.id, f.vehicle_id, f.created_at, v.slug, v.make, v.model, v.trim,
                v.year, v.mileage_km, v.price_cents, v.currency, v.status
         FROM customer_favorite f
         JOIN vehicle v ON v.id = f.vehicle_id
         WHERE f.account_id = ?
         ORDER BY f.created_at DESC
         LIMIT 200`,
      )
      .bind(accountId)
      .all<{
        id: string;
        vehicle_id: string;
        created_at: string;
        slug: string;
        make: string;
        model: string;
        trim: string;
        year: number;
        mileage_km: number;
        price_cents: number;
        currency: string;
        status: string;
      }>();
    return (result.results ?? []).map((row) =>
      Object.freeze({
        id: String(row.id),
        vehicleId: String(row.vehicle_id),
        slug: String(row.slug),
        make: String(row.make),
        model: String(row.model),
        trim: String(row.trim),
        year: Number(row.year),
        mileageKm: Number(row.mileage_km),
        priceCents: Number(row.price_cents),
        currency: String(row.currency),
        status: String(row.status),
        createdAt: String(row.created_at),
      }),
    );
  }

  /** Idempotente: marcar dos veces el mismo vehículo no duplica ni falla. */
  async addFavorite(input: {
    favoriteId: string;
    accountId: string;
    vehicleId: string;
    occurredAt: string;
  }): Promise<{ ok: boolean; reason?: "vehicle_not_found" }> {
    const vehicle = await this.d1
      .prepare("SELECT id FROM vehicle WHERE id = ? AND status = 'AVAILABLE' LIMIT 1")
      .bind(input.vehicleId)
      .first<{ id: string }>();
    if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
    await this.d1
      .prepare(
        `INSERT INTO customer_favorite (id, account_id, vehicle_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id, vehicle_id) DO NOTHING`,
      )
      .bind(input.favoriteId, input.accountId, input.vehicleId, input.occurredAt)
      .run();
    return { ok: true };
  }

  async removeFavorite(accountId: string, vehicleId: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM customer_favorite WHERE account_id = ? AND vehicle_id = ?")
      .bind(accountId, vehicleId)
      .run();
  }

  async listSavedSearches(accountId: string): Promise<readonly CustomerSavedSearchRecord[]> {
    const result = await this.d1
      .prepare(
        `SELECT id, name, query_json, created_at
         FROM customer_saved_search WHERE account_id = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(accountId)
      .all<{ id: string; name: string; query_json: string; created_at: string }>();
    return (result.results ?? []).map((row) =>
      Object.freeze({
        id: String(row.id),
        name: String(row.name),
        query: parseJsonObject(row.query_json) ?? {},
        createdAt: String(row.created_at),
      }),
    );
  }

  async saveSearch(input: {
    searchId: string;
    accountId: string;
    name: string;
    query: Record<string, unknown>;
    occurredAt: string;
  }): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO customer_saved_search (id, account_id, name, query_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, name) DO UPDATE SET
           query_json = excluded.query_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.searchId,
        input.accountId,
        input.name,
        JSON.stringify(input.query),
        input.occurredAt,
        input.occurredAt,
      )
      .run();
  }

  async removeSavedSearch(accountId: string, searchId: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM customer_saved_search WHERE account_id = ? AND id = ?")
      .bind(accountId, searchId)
      .run();
  }

  /**
   * Tasaciones y simulaciones de la persona. Se resuelven por el lead vinculado
   * a la cuenta: sin lead vinculado no hay actividad que mostrar, y nunca se
   * devuelve la de otro lead.
   */
  async readActivity(leadId: string | null): Promise<CustomerActivityRecord> {
    if (!leadId) return Object.freeze({ appraisals: [], simulations: [] });

    const [appraisals, simulations] = await Promise.all([
      this.d1
        .prepare(
          `SELECT public_code, vehicle_description, status, low_cents, base_cents,
                  high_cents, currency, created_at
           FROM appraisal WHERE lead_id = ?
           ORDER BY created_at DESC LIMIT 50`,
        )
        .bind(leadId)
        .all<{
          public_code: string;
          vehicle_description: string;
          status: string;
          low_cents: number | null;
          base_cents: number | null;
          high_cents: number | null;
          currency: string;
          created_at: string;
        }>(),
      this.d1
        .prepare(
          `SELECT s.public_code, s.status, s.classification, s.effective_price_cents,
                  s.installment_cents, s.term_months, s.currency, s.expires_at,
                  s.created_at, v.slug AS vehicle_slug,
                  v.make || ' ' || v.model || ' ' || v.trim AS vehicle_name
           FROM simulation s
           LEFT JOIN vehicle v ON v.id = s.vehicle_id
           WHERE s.lead_id = ?
           ORDER BY s.created_at DESC LIMIT 50`,
        )
        .bind(leadId)
        .all<{
          public_code: string;
          status: string;
          classification: string;
          effective_price_cents: number;
          installment_cents: number | null;
          term_months: number | null;
          currency: string;
          expires_at: string;
          created_at: string;
          vehicle_slug: string | null;
          vehicle_name: string | null;
        }>(),
    ]);

    return Object.freeze({
      appraisals: (appraisals.results ?? []).map((row) =>
        Object.freeze({
          publicCode: String(row.public_code),
          vehicleDescription: String(row.vehicle_description),
          status: String(row.status),
          lowCents: row.low_cents === null ? null : Number(row.low_cents),
          baseCents: row.base_cents === null ? null : Number(row.base_cents),
          highCents: row.high_cents === null ? null : Number(row.high_cents),
          currency: String(row.currency),
          createdAt: String(row.created_at),
        }),
      ),
      simulations: (simulations.results ?? []).map((row) =>
        Object.freeze({
          publicCode: String(row.public_code),
          status: String(row.status),
          classification: String(row.classification),
          vehicleName: row.vehicle_name === null ? null : String(row.vehicle_name),
          vehicleSlug: row.vehicle_slug === null ? null : String(row.vehicle_slug),
          effectivePriceCents: Number(row.effective_price_cents),
          installmentCents: row.installment_cents === null ? null : Number(row.installment_cents),
          termMonths: row.term_months === null ? null : Number(row.term_months),
          currency: String(row.currency),
          expiresAt: String(row.expires_at),
          createdAt: String(row.created_at),
        }),
      ),
    });
  }
}
