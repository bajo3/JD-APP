import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { RemoteSupabaseError, SUPABASE_POSTGRES_OPTIONS, SupabaseD1Database } from "./supabase-remote";
import * as schema from "./schema";

let pgClient: postgres.Sql | undefined;
let d1Binding: D1Database | undefined;

function getPgClient(): postgres.Sql {
  pgClient ??= postgres(requiredEnvironment("SUPABASE_DB_URL"), {
    ssl: "require",
    // Las funciones serverless no mantienen un pool caliente entre
    // invocaciones; una conexión corta por request evita agotar el límite
    // del pooler de Supabase.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ...SUPABASE_POSTGRES_OPTIONS,
  });
  return pgClient;
}

/**
 * Compatibilidad hacia atrás para los repositorios de `lib/data/*.ts`
 * escritos contra el contrato `D1Database` (`prepare/bind/first/all/run/
 * batch`). El motor real detrás es Postgres; ver `db/supabase-remote.ts`.
 */
export function getD1Binding(): D1Database {
  d1Binding ??= new SupabaseD1Database({ connectionString: "", sql: getPgClient() });
  return d1Binding;
}

/** Cliente Drizzle tipado contra el esquema, para el código que usa el
 * query builder (`db.select()...from()...where()`) en vez de SQL crudo. */
export function getDb() {
  return drizzle(getPgClient(), { schema });
}

export type Database = ReturnType<typeof getDb>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new RemoteSupabaseError("SUPABASE_REMOTE_CONFIG_INVALID");
  return value;
}
