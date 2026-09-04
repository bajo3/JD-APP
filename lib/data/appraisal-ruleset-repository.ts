import { getD1Binding } from "@/db";
import { normalizeAppraisalRuleset } from "@/lib/domain/appraisal-range.mjs";

export type PublishedAppraisalRuleset = Readonly<{
  id: string;
  version: number;
  ruleset: ReturnType<typeof normalizeAppraisalRuleset>;
}>;

export type AppraisalRulesetListItem = Readonly<{
  id: string;
  version: number;
  lockVersion: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  validFrom: string | null;
  validUntil: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
  referenceCount: number;
}>;

export type AppraisalRulesetActor = Readonly<{
  userId: string;
  email: string;
}>;

type StoredRuleset = Readonly<{
  id: string;
  version: number;
  status: string;
  rules_json: string;
  valid_from: string | null;
  valid_until: string | null;
  published_by: string | null;
  lock_version: number;
  created_at: string;
  updated_at: string;
}>;

type IdempotencyRow = Readonly<{ request_hash: string; resource_id: string }>;

/**
 * Fuente única de referencias para la cotización conversacional. Sólo una
 * versión PUBLISHED y vigente puede habilitar un rango; un borrador o una
 * versión vencida no se convierten en una cifra para el cliente.
 */
export class D1AppraisalRulesetRepository {
  constructor(private readonly d1: D1Database = getD1Binding()) {}

  async list(): Promise<AppraisalRulesetListItem[]> {
    const result = await this.d1
      .prepare(
        `SELECT id, version, status, rules_json, valid_from, valid_until, published_by,
                lock_version, created_at, updated_at
           FROM appraisal_rule_set
          ORDER BY version DESC`,
      )
      .all<StoredRuleset>();
    return result.results.map((row) => {
      let referenceCount = 0;
      try {
        const parsed = JSON.parse(row.rules_json) as Record<string, unknown>;
        referenceCount = normalizeAppraisalRuleset({ ...parsed, version: String(row.version) }).references.size;
      } catch {
        // Un registro histórico dañado no se transforma en una referencia utilizable.
      }
      return {
        id: row.id,
        version: Number(row.version),
        lockVersion: Number(row.lock_version),
        status: normalizeStatus(row.status),
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        publishedBy: row.published_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        referenceCount,
      };
    });
  }

  async createDraft(input: {
    id: string;
    version: number;
    ruleset: Record<string, unknown>;
    validFrom: string | null;
    validUntil: string | null;
    idempotencyKey: string;
    requestHash: string;
    actor: AppraisalRulesetActor;
    occurredAt: string;
  }): Promise<
    | { ok: true; record: AppraisalRulesetListItem; replayed: boolean }
    | { ok: false; reason: "idempotency_conflict" | "version_conflict" }
  > {
    const scope = "appraisal-rule-set.create";
    const existing = await this.findIdempotency(scope, input.idempotencyKey);
    if (existing) {
      if (existing.request_hash !== input.requestHash) return { ok: false, reason: "idempotency_conflict" };
      const record = await this.findListItem(existing.resource_id);
      if (record) return { ok: true, record, replayed: true };
    }
    const rulesJson = JSON.stringify(input.ruleset);
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO admin_idempotency
             (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
           SELECT ?, ?, ?, ?, 'appraisal_rule_set', ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM appraisal_rule_set WHERE version = ?)
           ON CONFLICT(scope, idempotency_key) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), scope, input.idempotencyKey, input.requestHash, input.id, input.actor.userId, input.version),
      this.d1
        .prepare(
          `INSERT INTO appraisal_rule_set
             (id, version, status, rules_json, valid_from, valid_until, published_by, lock_version, created_at, updated_at)
           SELECT ?, ?, 'DRAFT', ?, ?, ?, NULL, 1, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM admin_idempotency
               WHERE scope = ? AND idempotency_key = ? AND request_hash = ? AND resource_id = ?
            )
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          input.id,
          input.version,
          rulesJson,
          input.validFrom,
          input.validUntil,
          input.occurredAt,
          input.occurredAt,
          scope,
          input.idempotencyKey,
          input.requestHash,
          input.id,
        ),
      this.d1
        .prepare(
          `INSERT INTO admin_audit_log
             (id, actor_user_id, actor_email, action, resource_type, resource_id,
              previous_version, next_version, summary_json, occurred_at)
           SELECT ?, ?, ?, 'APPRAISAL_RULE_SET_CREATED', 'appraisal_rule_set', ?, NULL, 1, ?, ?
            WHERE changes() > 0
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          input.actor.userId,
          input.actor.email,
          input.id,
          JSON.stringify({ commercialVersion: input.version, referenceCount: normalizeAppraisalRuleset(input.ruleset).references.size }),
          input.occurredAt,
        ),
    ]);
    const winner = await this.findIdempotency(scope, input.idempotencyKey);
    if (!winner) return { ok: false, reason: "version_conflict" };
    if (winner.request_hash !== input.requestHash) return { ok: false, reason: "idempotency_conflict" };
    const record = await this.findListItem(winner.resource_id);
    if (!record) return { ok: false, reason: "version_conflict" };
    return { ok: true, record, replayed: winner.resource_id !== input.id };
  }

  async publish(input: {
    id: string;
    expectedLockVersion: number;
    actor: AppraisalRulesetActor;
    occurredAt: string;
  }): Promise<{ ok: true; record: AppraisalRulesetListItem } | { ok: false; reason: "not_found" | "conflict" }> {
    const update = this.d1
      .prepare(
        `UPDATE appraisal_rule_set
            SET status = 'PUBLISHED', published_by = ?, lock_version = lock_version + 1, updated_at = ?
          WHERE id = ? AND status = 'DRAFT' AND lock_version = ?`,
      )
      .bind(input.actor.email, input.occurredAt, input.id, input.expectedLockVersion);
    const audit = this.d1
      .prepare(
        `INSERT INTO admin_audit_log
           (id, actor_user_id, actor_email, action, resource_type, resource_id,
            previous_version, next_version, summary_json, occurred_at)
         SELECT ?, ?, ?, 'APPRAISAL_RULE_SET_PUBLISHED', 'appraisal_rule_set', ?, lock_version - 1, lock_version,
                json_object('commercialVersion', version), ?
           FROM appraisal_rule_set
          WHERE changes() > 0 AND id = ?
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), input.actor.userId, input.actor.email, input.id, input.occurredAt, input.id);
    const result = await this.d1.batch([update, audit]);
    if (Number(result[0].meta?.changes ?? 0) === 0) {
      return (await this.findListItem(input.id)) ? { ok: false, reason: "conflict" } : { ok: false, reason: "not_found" };
    }
    const record = await this.findListItem(input.id);
    return record ? { ok: true, record } : { ok: false, reason: "not_found" };
  }

  async findCurrent(now = new Date()): Promise<PublishedAppraisalRuleset | null> {
    const instant = now.toISOString();
    const row = await this.d1
      .prepare(
        `SELECT id, version, rules_json
           FROM appraisal_rule_set
          WHERE status = 'PUBLISHED'
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until > ?)
          ORDER BY version DESC
          LIMIT 1`,
      )
      .bind(instant, instant)
      .first<{ id: string; version: number; rules_json: string }>();
    if (!row) return null;
    try {
      return {
        id: row.id,
        version: Number(row.version),
        ruleset: normalizeAppraisalRuleset({
          ...(JSON.parse(row.rules_json) as Record<string, unknown>),
          version: String(row.version),
        }),
      };
    } catch {
      // Un tarifario corrupto nunca habilita una cotización. La revisión humana
      // sigue siendo el camino seguro hasta que el equipo lo corrija.
      return null;
    }
  }

  private async findIdempotency(scope: string, idempotencyKey: string): Promise<IdempotencyRow | null> {
    return this.d1
      .prepare(
        `SELECT request_hash, resource_id FROM admin_idempotency
          WHERE scope = ? AND idempotency_key = ?`,
      )
      .bind(scope, idempotencyKey)
      .first<IdempotencyRow>();
  }

  private async findListItem(id: string): Promise<AppraisalRulesetListItem | null> {
    return (await this.list()).find((item) => item.id === id) ?? null;
  }
}

function normalizeStatus(value: string): AppraisalRulesetListItem["status"] {
  return value === "PUBLISHED" || value === "RETIRED" ? value : "DRAFT";
}

export type AppraisalRulesetRepositoryLike = Pick<D1AppraisalRulesetRepository, "findCurrent">;
