/**
 * Adaptador D1 para runtimes que no tienen el binding de Workers (por ejemplo,
 * funciones Node de Vercel). Conserva el pequeño contrato D1 que consumen los
 * repositorios, incluida la ejecución atómica por lote del endpoint oficial.
 */

export type D1RemoteConfig = Readonly<{
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetch?: typeof fetch;
}>;

type D1Parameter = string | number | boolean | null;

type RemoteQuery = Readonly<{
  sql: string;
  params: readonly D1Parameter[];
}>;

type RemoteResult = Readonly<{
  results: Record<string, unknown>[];
  success: true;
  meta: Record<string, unknown>;
}>;

export class RemoteD1Error extends Error {
  readonly code: "D1_REMOTE_CONFIG_INVALID" | "D1_REMOTE_REQUEST_FAILED";

  constructor(code: RemoteD1Error["code"]) {
    super(
      code === "D1_REMOTE_CONFIG_INVALID"
        ? "La configuración de D1 remoto no es válida."
        : "La base de datos remota no respondió correctamente.",
    );
    this.name = "RemoteD1Error";
    this.code = code;
  }
}

export class RemoteD1Database implements D1Database {
  readonly #accountId: string;
  readonly #databaseId: string;
  readonly #apiToken: string;
  readonly #fetch: typeof fetch;

  constructor(config: D1RemoteConfig) {
    if (!isIdentifier(config.accountId) || !isIdentifier(config.databaseId) || !config.apiToken.trim()) {
      throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
    }
    this.#accountId = config.accountId.trim();
    this.#databaseId = config.databaseId.trim();
    this.#apiToken = config.apiToken.trim();
    this.#fetch = config.fetch ?? fetch;
  }

  prepare(query: string): D1PreparedStatement {
    if (!query.trim()) throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
    return new RemoteD1PreparedStatement(this, { sql: query, params: [] });
  }

  async batch<T = D1Result>(statements: D1PreparedStatement[]): Promise<T[]> {
    if (statements.length === 0) return [];
    const queries = statements.map((statement) => {
      if (!(statement instanceof RemoteD1PreparedStatement) || statement.database !== this) {
        throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
      }
      return statement.query;
    });
    const results = await this.#query({ batch: queries }, queries.length);
    return results.map(toD1Result) as T[];
  }

  async exec(query: string): Promise<D1Result> {
    // `exec` is allowed to carry SQL with multiple statements. The REST API
    // may return one result per statement; callers of run/first/all remain
    // strict and require exactly one result.
    const [result] = await this.#query({ sql: query, params: [] }, null);
    return toD1Result(result);
  }

  async dump(): Promise<ArrayBuffer> {
    throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
  }

  async run(query: RemoteQuery): Promise<D1Result> {
    const [result] = await this.#query(query, 1);
    return toD1Result(result);
  }

  async #query(
    body: { sql: string; params: readonly D1Parameter[] } | { batch: readonly RemoteQuery[] },
    expectedResults: number | null,
  ): Promise<RemoteResult[]> {
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.#accountId)}/d1/database/${encodeURIComponent(this.#databaseId)}/query`,
        {
          method: "POST",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${this.#apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new RemoteD1Error("D1_REMOTE_REQUEST_FAILED");
    }

    if (!response.ok) throw new RemoteD1Error("D1_REMOTE_REQUEST_FAILED");

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new RemoteD1Error("D1_REMOTE_REQUEST_FAILED");
    }
    if (!isRemoteEnvelope(payload, expectedResults)) {
      throw new RemoteD1Error("D1_REMOTE_REQUEST_FAILED");
    }
    return payload.result;
  }
}

class RemoteD1PreparedStatement implements D1PreparedStatement {
  readonly database: RemoteD1Database;
  readonly query: RemoteQuery;

  constructor(
    database: RemoteD1Database,
    query: RemoteQuery,
  ) {
    this.database = database;
    this.query = query;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new RemoteD1PreparedStatement(this.database, {
      sql: this.query.sql,
      params: values.map(toParameter),
    });
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.database.run(this.query);
    const row = result.results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.run(this.query) as Promise<D1Result<T>>;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.run(this.query) as Promise<D1Result<T>>;
  }

  async raw<T extends unknown[] = unknown[]>(): Promise<T[]> {
    const result = await this.database.run(this.query);
    return result.results.map((row) => Object.values(row) as T);
  }
}

function toD1Result(result: RemoteResult): D1Result {
  return {
    results: result.results,
    success: true,
    meta: result.meta,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRemoteResult(value: unknown): RemoteResult | null {
  if (!isRecord(value) || value.success !== true) return null;
  const rawResults = value.results;
  if (
    rawResults !== undefined &&
    (!Array.isArray(rawResults) || rawResults.some((row) => !isRecord(row)))
  ) {
    return null;
  }
  const rawMeta = value.meta;
  if (rawMeta !== undefined && !isRecord(rawMeta)) return null;
  return {
    success: true,
    results: (rawResults ?? []) as Record<string, unknown>[],
    meta: (rawMeta ?? {}) as Record<string, unknown>,
  };
}

function isRemoteEnvelope(
  value: unknown,
  expectedResults: number | null,
): value is { success: true; result: RemoteResult[] } {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.result)) {
    return false;
  }
  if (expectedResults === null) {
    if (value.result.length === 0) return false;
  } else if (value.result.length !== expectedResults) {
    return false;
  }
  const normalized = value.result.map(normalizeRemoteResult);
  if (normalized.some((result) => result === null)) return false;
  (value as { result: RemoteResult[] }).result = normalized as RemoteResult[];
  return true;
}

function toParameter(value: unknown): D1Parameter {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value.trim());
}
