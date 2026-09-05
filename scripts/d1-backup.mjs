// Backup, restore and restore-drill for the Supabase (Postgres) database.
//
//   node scripts/d1-backup.mjs                      # dump every table's data
//   node scripts/d1-backup.mjs --drill               # dump + restore into a
//                                                     # throwaway schema and
//                                                     # compare row counts
//   node scripts/d1-backup.mjs --restore <file> --confirm-restore
//
// There is only one real database, so a plain dump or a drill never need a
// confirmation flag: a drill only ever touches a throwaway schema it creates
// and drops itself, and a dump is a read. A restore replaces every row in
// every table this project owns, so it always needs --confirm-restore.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { resolveDataRuntime } from "./data-runtime.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const META_DIR = join(SCRIPT_DIR, "..", "drizzle", "meta");
const MIGRATION_FILE = join(SCRIPT_DIR, "..", "drizzle", "0000_skinny_ben_parker.sql");

function latestSnapshot(metaDir = META_DIR) {
  const snapshots = readdirSync(metaDir)
    .filter((name) => /^[0-9]{4}_snapshot\.json$/.test(name))
    .sort();
  const latest = snapshots.at(-1);
  if (!latest) {
    throw new Error("No hay snapshots de Drizzle para derivar las tablas del ensayo.");
  }
  return JSON.parse(readFileSync(join(metaDir, latest), "utf8"));
}

// Every table of the schema must survive a restore untouched. The list is
// derived from the newest Drizzle snapshot instead of being written by hand, so
// a new migration can never leave a table outside the drill.
export function readSchemaTables(metaDir = META_DIR) {
  const snapshot = latestSnapshot(metaDir);
  // El snapshot de Postgres califica cada tabla con su esquema
  // ("public.vehicle"); el nombre corto alcanza para el SQL que arma este
  // script porque todo vive en el `search_path` por defecto.
  const tables = Object.keys(snapshot.tables ?? {}).map((name) => name.replace(/^[a-z_]+\./, ""));
  if (tables.length === 0) {
    throw new Error(`El snapshot ${metaDir} no declara tablas.`);
  }
  // The names are interpolated into SQL, so they never leave this alphabet.
  const invalid = tables.filter((name) => !/^[A-Za-z0-9_]+$/.test(name));
  if (invalid.length > 0) {
    throw new Error(`Nombre de tabla no admitido en el snapshot: ${invalid.join(", ")}.`);
  }
  return tables.sort();
}

export const DRILL_TABLES = readSchemaTables();

// Una fila con una FK no puede insertarse antes que la fila a la que apunta.
// El propio snapshot de Drizzle ya declara cada FK, así que el orden de
// volcado/restauración sale de ahí en vez de escribirse a mano.
export function topologicalTableOrder(metaDir = META_DIR) {
  const snapshot = latestSnapshot(metaDir);
  const shortName = (qualified) => qualified.replace(/^[a-z_]+\./, "");
  const tables = Object.keys(snapshot.tables ?? {}).map(shortName);
  const dependsOn = new Map(tables.map((name) => [name, new Set()]));
  for (const [qualified, table] of Object.entries(snapshot.tables ?? {})) {
    const from = shortName(qualified);
    for (const foreignKey of Object.values(table.foreignKeys ?? {})) {
      const to = shortName(foreignKey.tableTo ?? "");
      if (to && to !== from && dependsOn.has(to)) dependsOn.get(from).add(to);
    }
  }
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(name) {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const dependency of dependsOn.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  }
  for (const name of [...tables].sort()) visit(name);
  return ordered;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

// Renders one table's rows as a single INSERT, in column order taken from the
// first row (postgres.js preserves the SELECT's column order as JS key
// insertion order). An empty table produces no statement at all.
export function dumpTableRows(table, rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const values = rows
    .map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`)
    .join(",\n  ");
  return `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES\n  ${values};`;
}

export function backupFileName(now = new Date()) {
  return `supabase-${now.toISOString().replace(/[:.]/g, "-")}.sql`;
}

export function compareCounts(source, restored) {
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const format = (value) => (validCount(value) ? String(value) : "inválido");
  return DRILL_TABLES.filter((table) => {
    const sourceCount = source && typeof source === "object" ? source[table] : undefined;
    const restoredCount = restored && typeof restored === "object" ? restored[table] : undefined;
    return !validCount(sourceCount) || !validCount(restoredCount) || sourceCount !== restoredCount;
  }).map((table) => {
    const sourceCount = source && typeof source === "object" ? source[table] : undefined;
    const restoredCount = restored && typeof restored === "object" ? restored[table] : undefined;
    return `${table}: origen ${format(sourceCount)} vs restaurado ${format(restoredCount)}`;
  });
}

export function parseArgs(argv) {
  const restoreIndex = argv.indexOf("--restore");
  const restore = restoreIndex >= 0 ? argv[restoreIndex + 1] : null;
  if (restoreIndex >= 0) {
    if (!restore) throw new Error("--restore needs the path of a dump file.");
    if (!argv.includes("--confirm-restore")) {
      throw new Error("Restoring overwrites data: pass --confirm-restore to proceed.");
    }
  }
  const outputIndex = argv.indexOf("--output");
  return {
    restore,
    drill: argv.includes("--drill"),
    output: outputIndex >= 0 ? argv[outputIndex + 1] : null,
  };
}

async function countsFor(runtime, schema) {
  const command = `SELECT ${DRILL_TABLES.map(
    (table) => `(SELECT COUNT(*) FROM "${schema}"."${table}") AS "${table}"`,
  ).join(", ")}`;
  const { results } = await runtime.d1.exec(command);
  return results[0] ?? {};
}

async function dumpAllTables(runtime, order = topologicalTableOrder()) {
  const parts = [];
  for (const table of order) {
    const rows = await runtime.sql.unsafe(`SELECT * FROM "public"."${table}"`);
    const statement = dumpTableRows(table, [...rows]);
    if (statement) parts.push(statement);
  }
  return `${parts.join("\n\n")}\n`;
}

function exportTo(dumpSql, output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, dumpSql, "utf8");
}

async function restoreInto(runtime, dumpSql) {
  const truncate = `TRUNCATE TABLE ${DRILL_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`;
  await runtime.d1.exec(`${truncate}\n${dumpSql}`);
}

// El ensayo nunca toca `public`: crea un esquema descartable, le clona la
// estructura corriendo la misma migración que ya vive en drizzle/ con el
// `search_path` apuntado ahí, restaura el volcado adentro y compara los
// conteos contra el esquema real. `SET`/`RESET search_path` viajan en la
// misma llamada que las sentencias que dependen de ellos, así que la
// conexión (con `max: 1`, se reutiliza entre llamadas) siempre vuelve al
// estado por defecto antes de que el script siga.
async function runDrill(runtime, dumpSql) {
  const schema = `drill_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const migrationSql = readFileSync(MIGRATION_FILE, "utf8").replaceAll("--> statement-breakpoint", "");
  try {
    await runtime.d1.exec(
      [
        `CREATE SCHEMA "${schema}";`,
        `SET search_path TO "${schema}";`,
        migrationSql,
        dumpSql,
        "RESET search_path;",
      ].join("\n"),
    );
    const source = await countsFor(runtime, "public");
    const restored = await countsFor(runtime, schema);
    const drift = compareCounts(source, restored);
    if (drift.length > 0) {
      console.error("El ensayo de restauración no coincide:");
      for (const line of drift) console.error(`  - ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Ensayo de restauración correcto: ${DRILL_TABLES.length} tablas con los mismos conteos de registros.`,
    );
  } finally {
    await runtime.d1.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  }
}

export async function runBackup(argv = process.argv.slice(2)) {
  const projectRoot = join(SCRIPT_DIR, "..");
  const options = parseArgs(argv);
  const runtime = resolveDataRuntime({ remote: true, confirmRemote: true });
  try {
    if (options.restore) {
      const file = resolve(projectRoot, options.restore);
      if (!existsSync(file)) throw new Error(`Dump file not found: ${file}`);
      await restoreInto(runtime, readFileSync(file, "utf8"));
      console.log(`Restored ${file}.`);
      return;
    }

    const order = topologicalTableOrder();
    const dumpSql = await dumpAllTables(runtime, order);

    if (options.drill) {
      await runDrill(runtime, dumpSql);
      return;
    }

    const output = resolve(projectRoot, options.output ?? join("backups", backupFileName()));
    exportTo(dumpSql, output);
    console.log(`Backup written to ${output}`);
  } finally {
    await runtime.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  runBackup().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
