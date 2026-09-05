// Shared runtime resolution for the data-maintenance commands (seed, backup,
// migrate, stock:sync). The application's persistence is Supabase Postgres,
// reached over a plain connection string — there is no local/remote D1
// binding to resolve anymore, no Wrangler process to shell out to, and no
// `wrangler.data.json` to keep in sync with the hosted environment.
//
// The commands this module serves are destructive or write real commercial
// data, so the safety habit from the D1 era is kept: any invocation that
// touches the database requires the connection string to be present, and
// `--remote` still exists as an explicit, opt-in acknowledgement that the
// command is about to write to the one real Supabase project, not a
// disposable local database — most of these scripts don't have a "local"
// alternative anymore, so the flag mainly documents intent at the call site.
import postgres from "postgres";
import { SUPABASE_POSTGRES_OPTIONS, SupabaseD1Database } from "../db/supabase-remote.ts";

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value.trim();
}

export function resolveDataRuntime(options = {}) {
  const remote = options.remote === true;
  if (remote && options.confirmRemote !== true) {
    throw new Error("Escribir contra Supabase requiere el flag explícito --confirm-remote.");
  }
  const connectionString = requiredString(process.env.SUPABASE_DB_URL, "SUPABASE_DB_URL");

  let sqlClient = null;
  let d1 = null;
  const getSql = () => {
    sqlClient ??= postgres(connectionString, {
      ssl: "require",
      max: 1,
      // Un "CREATE TABLE IF NOT EXISTS" sobre una tabla que ya existe es un
      // NOTICE de Postgres, no un error; por defecto postgres.js lo imprime
      // por consola en cada corrida idempotente de estos scripts.
      onnotice: () => {},
      ...SUPABASE_POSTGRES_OPTIONS,
    });
    return sqlClient;
  };
  const getD1 = () => {
    d1 ??= new SupabaseD1Database({ connectionString: "", sql: getSql() });
    return d1;
  };

  return {
    remote,
    connectionString,
    get sql() {
      return getSql();
    },
    get d1() {
      return getD1();
    },
    async cleanup() {
      if (sqlClient) await sqlClient.end({ timeout: 5 });
    },
  };
}
