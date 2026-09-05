// Applies the Drizzle migrations in drizzle/ to a D1 database, local or
// remote, recording every applied file in schema_migrations so the same
// command is safe to repeat. Databases created before this tracking table
// existed must be marked with --baseline <id> once.
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveDataRuntime } from "./data-runtime.mjs";

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY NOT NULL,
  applied_at text NOT NULL
);`;

export function parseArgs(argv) {
  const remote = argv.includes("--remote");
  if (remote && !argv.includes("--confirm-remote")) {
    throw new Error("Remote migrations require the explicit --confirm-remote flag.");
  }
  const databaseIndex = argv.indexOf("--database");
  const database = databaseIndex >= 0 ? argv[databaseIndex + 1] : "DB";
  if (!database || !/^[A-Za-z0-9_-]+$/.test(database)) {
    throw new Error("Invalid D1 database name.");
  }
  const baselineIndex = argv.indexOf("--baseline");
  const baseline = baselineIndex >= 0 ? argv[baselineIndex + 1] : null;
  if (baselineIndex >= 0 && !/^[0-9]{4}_[A-Za-z0-9_]+$/.test(baseline ?? "")) {
    throw new Error("--baseline needs a migration id such as 0004_furry_ultimatum.");
  }
  return { database, remote, baseline, dryRun: argv.includes("--dry-run") };
}

export function listMigrations(projectRoot) {
  const dir = join(projectRoot, "drizzle");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ id: name.replace(/\.sql$/, ""), path: join(dir, name) }));
}

export function pendingMigrations(all, applied, baseline) {
  const done = new Set(applied);
  if (baseline) {
    for (const migration of all) {
      done.add(migration.id);
      if (migration.id === baseline) break;
    }
    if (!all.some((migration) => migration.id === baseline)) {
      throw new Error(`Baseline ${baseline} is not a known migration.`);
    }
  }
  return all.filter((migration) => !done.has(migration.id));
}

function resolveRuntime(options, projectRoot) {
  return resolveDataRuntime(options, projectRoot);
}

function wranglerArgs(runtime, extra) {
  const args = [
    "d1",
    "execute",
    runtime.database,
    runtime.remote ? "--remote" : "--local",
    "--config",
    runtime.configPath,
    "--yes",
    ...extra,
  ];
  if (!runtime.remote) args.push("--persist-to", runtime.persistPath);
  return args;
}

function execute(runtime, extra, capture = false) {
  const result = spawnSync(process.execPath, [runtime.wrangler, ...wranglerArgs(runtime, extra)], {
    cwd: runtime.projectRoot,
    encoding: "utf8",
    env: runtime.wranglerEnv,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler d1 execute failed with status ${result.status}`);
  return capture ? result.stdout : "";
}

export function parseAppliedIds(stdout) {
  const start = stdout.indexOf("[");
  if (start < 0) return [];
  let payload;
  try {
    payload = JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
  const rows = Array.isArray(payload) ? (payload[0]?.results ?? []) : [];
  return rows.map((row) => String(row.id));
}

function runSqlFile(runtime, sql, label) {
  const tempDir = mkdtempSync(join(tmpdir(), "jda-d1-migrate-"));
  const file = join(tempDir, `${label}.sql`);
  try {
    writeFileSync(file, sql, { encoding: "utf8", flag: "wx" });
    execute(runtime, ["--file", file]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function runMigrations(argv = process.argv.slice(2)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const runtime = resolveRuntime(parseArgs(argv), join(scriptDir, ".."));
  try {
    const all = listMigrations(runtime.projectRoot);

    runSqlFile(runtime, TRACKING_TABLE, "tracking");
    const applied = parseAppliedIds(
      execute(runtime, ["--json", "--command", "SELECT id FROM schema_migrations ORDER BY id"], true),
    );
    const pending = pendingMigrations(all, applied, runtime.baseline);

    if (runtime.baseline) {
      const marks = all
        .slice(0, all.findIndex((migration) => migration.id === runtime.baseline) + 1)
        .filter((migration) => !applied.includes(migration.id));
      if (marks.length > 0 && runtime.dryRun) {
        console.log(`Would baseline ${marks.length} migration(s) up to ${runtime.baseline}.`);
      } else if (marks.length > 0) {
        runSqlFile(
          runtime,
          marks
            .map(
              (migration) =>
                `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', '${new Date().toISOString()}');`,
            )
            .join("\n"),
          "baseline",
        );
        console.log(`Baselined ${marks.length} migration(s) up to ${runtime.baseline}.`);
      }
    }

    if (pending.length === 0) {
      console.log("D1 schema is up to date.");
      return;
    }
    if (runtime.dryRun) {
      console.log(`Pending: ${pending.map((migration) => migration.id).join(", ")}`);
      return;
    }

    for (const migration of pending) {
      console.log(`Applying ${migration.id}…`);
      const sql = readFileSync(migration.path, "utf8");
      runSqlFile(
        runtime,
        `${sql}\n--> statement-breakpoint\nINSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', '${new Date().toISOString()}');`,
        migration.id,
      );
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    runtime.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) runMigrations();
