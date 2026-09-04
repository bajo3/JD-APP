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
  results?: Record<string, unknown>[];
  success?: boolean;
  meta?: Record<string, unknown>;
}>;

type RemoteEnvelope = Readonly<{
  success?: boolean;
  result?: RemoteResult[];
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
    const queries = statements.map((statement) => {
      if (!(statement instanceof RemoteD1PreparedStatement) || statement.database !== this) {
        throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
      }
      return statement.query;
    });
    const results = await this.#query({ batch: queries });
    return results.map(toD1Result) as T[];
  }

  async exec(query: string): Promise<D1Result> {
    const [result] = await this.#query({ sql: query, params: [] });
    return toD1Result(result ?? { results: [], success: true, meta: {} });
  }

  async dump(): Promise<ArrayBuffer> {
    throw new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
  }

  async run(query: RemoteQuery): Promise<D1Result> {
    const [result] = await this.#query(query);
    return toD1Result(result ?? { results: [], success: true, meta: {} });
  }

  async #query(body: { sql: string; params: readonly D1Parameter[] } | { batch: readonly RemoteQuery[] }): Promise<RemoteResult[]> {
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

    let payload: RemoteEnvelope;
    try {
      payload = await response.json() as RemoteEnvelope;
    } catch {
      throw new RemoteD1Error("D1_REMOTE_REQUEST_FAILED");
    }
    if (!payload.success || !Array.isArray(payload.result) || payload.result.some((result) => result.success !== true)) {
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
    results: result.results ?? [],
    success: result.success === true,
    meta: result.meta ?? {},
  };
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
