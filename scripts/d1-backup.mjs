// Backup, restore and restore-drill for the D1 database.
//
//   node scripts/d1-backup.mjs                      # dump the local database
//   node scripts/d1-backup.mjs --remote --confirm-remote
//   node scripts/d1-backup.mjs --drill              # dump + restore into a
//                                                   # throwaway database and
//                                                   # compare row counts
//   node scripts/d1-backup.mjs --restore <file> --confirm-restore
//
// A restore is destructive, so it always needs --confirm-restore, and the
// drill never writes to the database it read from.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveDataRuntime } from "./data-runtime.mjs";

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

// Every table of the schema must survive a restore untouched. The list is
// derived from the newest Drizzle snapshot instead of being written by hand, so
// a new migration can never leave a table outside the drill.
const META_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle", "meta");

export function readSchemaTables(metaDir = META_DIR) {
  const snapshots = readdirSync(metaDir)
    .filter((name) => /^[0-9]{4}_snapshot\.json$/.test(name))
    .sort();
  const latest = snapshots.at(-1);
  if (!latest) {
    throw new Error("No hay snapshots de Drizzle para derivar las tablas del ensayo.");
  }
  const snapshot = JSON.parse(readFileSync(join(metaDir, latest), "utf8"));
  const tables = Object.keys(snapshot.tables ?? {});
  if (tables.length === 0) {
    throw new Error(`El snapshot ${latest} no declara tablas.`);
  }
  // The names are interpolated into SQL, so they never leave this alphabet.
  const invalid = tables.filter((name) => !/^[A-Za-z0-9_]+$/.test(name));
  if (invalid.length > 0) {
    throw new Error(`Nombre de tabla no admitido en el snapshot: ${invalid.join(", ")}.`);
  }
  return tables.sort();
}

export const DRILL_TABLES = readSchemaTables();

export function parseArgs(argv) {
  const remote = argv.includes("--remote");
  if (remote && !argv.includes("--confirm-remote")) {
    throw new Error("Remote access requires the explicit --confirm-remote flag.");
  }
  const restoreIndex = argv.indexOf("--restore");
  const restore = restoreIndex >= 0 ? argv[restoreIndex + 1] : null;
  if (restoreIndex >= 0) {
    if (!restore) throw new Error("--restore needs the path of a dump file.");
    if (!argv.includes("--confirm-restore")) {
      throw new Error("Restoring overwrites data: pass --confirm-restore to proceed.");
    }
  }
  const outputIndex = argv.indexOf("--output");
  const databaseIndex = argv.indexOf("--database");
  const database = databaseIndex >= 0 ? argv[databaseIndex + 1] : "DB";
  if (!database || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new Error("Invalid D1 database name.");
  }
  return {
    database,
    remote,
    restore,
    drill: argv.includes("--drill"),
    output: outputIndex >= 0 ? argv[outputIndex + 1] : null,
  };
}

// Wrangler dumps every table in storage order, so an INSERT can arrive before
// the table its foreign key points at exists, and `d1 execute --file` runs one
// statement at a time with no transaction to defer the check. The dump is
// rewritten in restorable order: schema, then rows, then indexes.
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  for (const raw of sql.split(LF)) {
    const line = raw.endsWith(CR) ? raw.slice(0, -1) : raw;
    current += (current ? LF : "") + line;
    // A literal apostrophe is doubled inside SQLite strings, so an even
    // quote count means the statement is not inside a string any more.
    const quotes = (current.match(/'/g) ?? []).length;
    if (line.trimEnd().endsWith(";") && quotes % 2 === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function normalizeDump(sql) {
  const buckets = { pragma: [], table: [], other: [], insert: [], index: [] };
  for (const statement of splitStatements(sql)) {
    const head = statement.replace(/^\s+/, "").slice(0, 40).toUpperCase();
    if (head.startsWith("PRAGMA")) buckets.pragma.push(statement);
    else if (/^CREATE\s+(UNIQUE\s+)?INDEX/.test(head)) buckets.index.push(statement);
    else if (head.startsWith("CREATE TABLE")) buckets.table.push(statement);
    else if (head.startsWith("INSERT")) buckets.insert.push(statement);
    else buckets.other.push(statement);
  }
  const ordered = [
    ...buckets.pragma,
    ...buckets.table,
    ...buckets.other,
    ...buckets.insert,
    ...buckets.index,
  ];
  return ordered.join(LF) + LF;
}

export function backupFileName(now = new Date()) {
  return `d1-${now.toISOString().replace(/[:.]/g, "-")}.sql`;
}

function resolveRuntime(options, projectRoot) {
  return resolveDataRuntime(options, projectRoot);
}

function wrangle(runtime, args, { persistPath = runtime.persistPath, capture = false, persist = true } = {}) {
  const full = [...args, "--config", runtime.configPath];
  if (!runtime.remote && persist) full.push("--persist-to", persistPath);
  const result = spawnSync(process.execPath, [runtime.wrangler, ...full], {
    cwd: runtime.projectRoot,
    encoding: "utf8",
    env: runtime.wranglerEnv,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler failed with status ${result.status}`);
  return capture ? result.stdout : "";
}

// `d1 export` has no --persist-to: the versioned data config lives at the
// project root, so Wrangler can find the local state without a build artifact.
function exportTo(runtime, output) {
  mkdirSync(dirname(output), { recursive: true });
  wrangle(
    runtime,
    ["d1", "export", runtime.database, runtime.remote ? "--remote" : "--local", "-y", "--output", output],
    { persist: false },
  );
  writeFileSync(output, normalizeDump(readFileSync(output, "utf8")), "utf8");
  return output;
}

function executeFile(runtime, file, persistPath) {
  wrangle(
    runtime,
    ["d1", "execute", runtime.database, runtime.remote ? "--remote" : "--local", "--yes", "--file", file],
    { persistPath },
  );
}

export function parseCounts(stdout) {
  const start = stdout.indexOf("[");
  if (start < 0) return {};
  let payload;
  try {
    payload = JSON.parse(stdout.slice(start));
  } catch {
    return {};
  }
  const row = (Array.isArray(payload) ? payload : [])[0]?.results?.[0];
  if (!row) return {};
  return Object.fromEntries(Object.entries(row).map(([table, total]) => [table, Number(total)]));
}

// One row with a column per table: D1 rejects a compound SELECT this long.
function countsFrom(runtime, persistPath) {
  const command = `SELECT ${DRILL_TABLES.map(
    (table) => `(SELECT COUNT(*) FROM ${table}) AS "${table}"`,
  ).join(", ")}`;
  return parseCounts(
    wrangle(
      runtime,
      [
        "d1",
        "execute",
        runtime.database,
        runtime.remote ? "--remote" : "--local",
        "--json",
        "--command",
        command,
      ],
      { persistPath, capture: true },
    ),
  );
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

export function runBackup(argv = process.argv.slice(2)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(scriptDir, "..");
  const runtime = resolveRuntime(parseArgs(argv), projectRoot);
  try {
    if (runtime.restore) {
      const file = resolve(projectRoot, runtime.restore);
      if (!existsSync(file)) throw new Error(`Dump file not found: ${file}`);
      executeFile(runtime, file, runtime.persistPath);
      console.log(`Restored ${file}.`);
      return;
    }

    const output = resolve(projectRoot, runtime.output ?? join("backups", backupFileName()));
    exportTo(runtime, output);
    console.log(`Backup written to ${output}`);
    if (!runtime.drill) return;

    const sandbox = mkdtempSync(join(tmpdir(), "jda-d1-drill-"));
    try {
      const source = countsFrom(runtime, runtime.persistPath);
      executeFile({ ...runtime, remote: false, configPath: runtime.localConfigPath }, output, sandbox);
      const restored = countsFrom(
        { ...runtime, remote: false, configPath: runtime.localConfigPath },
        sandbox,
      );
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
      rmSync(sandbox, { recursive: true, force: true });
    }
  } finally {
    runtime.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) runBackup();
