/**
 * Adaptador Postgres/Supabase que implementa el mismo contrato D1
 * (`prepare/bind/first/all/run/batch`) que ya consumen los repositorios de
 * `lib/data/*.ts`. La migración de Cloudflare D1 a Supabase cambia el motor
 * de base de datos (SQLite -> Postgres), no la forma en que el resto del
 * código habla con la base: en vez de reescribir cada repositorio para un
 * cliente Postgres nativo, este adaptador conserva la interfaz D1 y traduce
 * lo poco que realmente difiere entre los dos dialectos:
 *
 * - placeholders posicionales `?` -> `$1, $2, ...`;
 * - `changes()` de SQLite (cuántas filas tocó la sentencia anterior en la
 *   misma conexión) no existe en Postgres. Dentro de un `batch()` —el único
 *   lugar donde este código lo usa, siempre como guarda de una sentencia
 *   dependiente de la anterior— se sustituye por el conteo real de filas
 *   afectadas por la sentencia previa en la misma transacción, antes de
 *   ejecutar cada sentencia.
 *
 * El resto del SQL (INSERT/UPDATE/SELECT, ON CONFLICT, RETURNING, CTEs) es
 * sintaxis estándar que ambos motores entienden igual.
 */

import postgres from "postgres";

type D1Parameter = string | number | boolean | null;

/**
 * `postgres.js` devuelve las columnas `bigint` (OID 20, usadas en este
 * esquema para todo importe en centavos: SQLite no distinguía int32/int64 y
 * un precio en pesos con inflación supera fácilmente los ~2.147 millones que
 * entran en un `integer` de Postgres) como texto por defecto, para no perder
 * precisión con valores fuera de `Number.MAX_SAFE_INTEGER`. Los importes de
 * esta aplicación nunca se acercan a ese límite, y todo el código de negocio
 * ya espera un `number` -como hacía contra D1-, así que se fuerza la
 * conversión acá, una sola vez, para cualquier cliente `postgres.js` que
 * hable con Supabase.
 */
export const SUPABASE_POSTGRES_OPTIONS = Object.freeze({
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (value: unknown) => String(value),
      parse: (value: string) => Number(value),
    },
  },
});

export type SupabaseRemoteConfig = Readonly<{
  connectionString: string;
  sql?: postgres.Sql;
}>;

export class RemoteSupabaseError extends Error {
  readonly code: "SUPABASE_REMOTE_CONFIG_INVALID" | "SUPABASE_REMOTE_REQUEST_FAILED";

  constructor(code: RemoteSupabaseError["code"], cause?: unknown) {
    super(
      code === "SUPABASE_REMOTE_CONFIG_INVALID"
        ? "La configuración de Supabase no es válida."
        : "La base de datos remota no respondió correctamente.",
    );
    this.name = "RemoteSupabaseError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Reemplaza cada `?` de izquierda a derecha por `$1, $2, ...`. El SQL de
 * estos repositorios nunca trae un `?` literal dentro de una cadena. */
function toPositionalSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${(index += 1)}`);
}

/** Sustituye `changes()` por el conteo literal de la sentencia anterior en
 * la misma transacción. Sólo aparece como guarda de una sentencia posterior
 * a otra dentro de un `batch()`; nunca en la primera sentencia de un lote. */
function substituteChanges(sql: string, previousChanges: number): string {
  return sql.replace(/\bchanges\(\)/g, String(previousChanges));
}

class SupabasePreparedStatement implements D1PreparedStatement {
  private readonly database: SupabaseD1Database;
  readonly sqlText: string;
  readonly params: readonly D1Parameter[];

  constructor(database: SupabaseD1Database, sqlText: string, params: readonly D1Parameter[] = []) {
    this.database = database;
    this.sqlText = sqlText;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SupabasePreparedStatement(this.database, this.sqlText, values.map(toParameter));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.database.runStatement(this);
    const row = result.results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.runStatement(this) as Promise<D1Result<T>>;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.runStatement(this) as Promise<D1Result<T>>;
  }

  async raw<T extends unknown[] = unknown[]>(): Promise<T[]> {
    const result = await this.database.runStatement(this);
    return result.results.map((row) => Object.values(row) as T);
  }
}

/**
 * Backed by `postgres.js`. Cada `.batch()` corre en una única transacción,
 * en el mismo orden en que las sentencias se declararon; una que falla
 * revierte el lote entero, igual que el `batch` atómico de D1.
 */
export class SupabaseD1Database implements D1Database {
  readonly #sql: postgres.Sql;

  constructor(config: SupabaseRemoteConfig) {
    if (config.sql) {
      this.#sql = config.sql;
      return;
    }
    const connectionString = config.connectionString.trim();
    if (!connectionString) throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
    this.#sql = postgres(connectionString, {
      ssl: "require",
      // Las funciones serverless de Vercel no mantienen un pool caliente
      // entre invocaciones; una conexión corta por request evita agotar el
      // límite del pooler de Supabase.
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ...SUPABASE_POSTGRES_OPTIONS,
    });
  }

  prepare(query: string): D1PreparedStatement {
    if (!query.trim()) throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
    return new SupabasePreparedStatement(this, query, []);
  }

  /** Uso interno: ejecuta una sola sentencia fuera de un batch. */
  async runStatement(statement: SupabasePreparedStatement): Promise<D1Result> {
    try {
      const rows = await this.#sql.unsafe(
        toPositionalSql(statement.sqlText),
        statement.params as postgres.ParameterOrJSON<never>[],
      );
      return {
        results: [...rows] as Record<string, unknown>[],
        success: true,
        meta: { changes: rows.count ?? 0 },
      };
    } catch (error) {
      throw new RemoteSupabaseError("SUPABASE_REMOTE_REQUEST_FAILED", error);
    }
  }

  async batch<T = D1Result>(statements: D1PreparedStatement[]): Promise<T[]> {
    if (statements.length === 0) return [];
    try {
      const results = await this.#sql.begin(async (tx) => {
        const out: D1Result[] = [];
        let previousChanges = 0;
        for (const statement of statements) {
          if (!(statement instanceof SupabasePreparedStatement)) {
            throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
          }
          const sql = substituteChanges(toPositionalSql(statement.sqlText), previousChanges);
          const rows = await tx.unsafe(sql, statement.params as postgres.ParameterOrJSON<never>[]);
          previousChanges = rows.count ?? 0;
          out.push({
            results: [...rows] as Record<string, unknown>[],
            success: true,
            meta: { changes: previousChanges },
          });
        }
        return out;
      });
      return results as T[];
    } catch (error) {
      if (error instanceof RemoteSupabaseError) throw error;
      throw new RemoteSupabaseError("SUPABASE_REMOTE_REQUEST_FAILED", error);
    }
  }

  async exec(query: string): Promise<D1Result> {
    try {
      const rows = await this.#sql.unsafe(query);
      return { results: [...rows] as Record<string, unknown>[], success: true, meta: { changes: rows.count ?? 0 } };
    } catch (error) {
      throw new RemoteSupabaseError("SUPABASE_REMOTE_REQUEST_FAILED", error);
    }
  }

  async dump(): Promise<ArrayBuffer> {
    throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}

function toParameter(value: unknown): D1Parameter {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
}
