// Applies the Drizzle migrations in drizzle/ to Supabase, recording every
// applied file in schema_migrations so the same command is safe to repeat.
// A database whose schema was created before this tracking table existed
// must be marked with --baseline <id> once.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDataRuntime } from "./data-runtime.mjs";

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY NOT NULL,
  applied_at text NOT NULL
);`;

export function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  if (!dryRun && !argv.includes("--confirm-remote")) {
    throw new Error("Migrar Supabase requiere el flag explícito --confirm-remote.");
  }
  const baselineIndex = argv.indexOf("--baseline");
  const baseline = baselineIndex >= 0 ? argv[baselineIndex + 1] : null;
  if (baselineIndex >= 0 && !/^[0-9]{4}_[A-Za-z0-9_]+$/.test(baseline ?? "")) {
    throw new Error("--baseline necesita un id de migración, por ejemplo 0000_skinny_ben_parker.");
  }
  return { dryRun, baseline, remote: true, confirmRemote: true };
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
    if (!all.some((migration) => migration.id === baseline)) {
      throw new Error(`Baseline ${baseline} is not a known migration.`);
    }
    for (const migration of all) {
      done.add(migration.id);
      if (migration.id === baseline) break;
    }
  }
  return all.filter((migration) => !done.has(migration.id));
}

// El SQL que emite drizzle-kit separa sentencias con un comentario propio que
// Postgres no necesita: el driver ya acepta un lote de sentencias separadas
// por ";" en una sola llamada.
function stripBreakpoints(sql) {
  return sql.replaceAll("--> statement-breakpoint", "");
}

export async function runMigrations(argv = process.argv.slice(2)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(scriptDir, "..");
  const options = parseArgs(argv);
  const runtime = resolveDataRuntime(options);
  try {
    const all = listMigrations(projectRoot);

    await runtime.d1.exec(TRACKING_TABLE);
    const appliedRows = await runtime.sql`SELECT id FROM schema_migrations ORDER BY id`;
    const applied = appliedRows.map((row) => String(row.id));
    const pending = pendingMigrations(all, applied, options.baseline);

    if (options.baseline) {
      const marks = all
        .slice(0, all.findIndex((migration) => migration.id === options.baseline) + 1)
        .filter((migration) => !applied.includes(migration.id));
      if (marks.length > 0 && options.dryRun) {
        console.log(`Se marcarían ${marks.length} migración(es) como base hasta ${options.baseline}.`);
      } else if (marks.length > 0) {
        const now = new Date().toISOString();
        await runtime.d1.exec(
          marks
            .map(
              (migration) =>
                `INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', '${now}') ON CONFLICT (id) DO NOTHING;`,
            )
            .join("\n"),
        );
        console.log(`Marcadas ${marks.length} migración(es) como base hasta ${options.baseline}.`);
      }
    }

    if (pending.length === 0) {
      console.log("El esquema de Supabase está al día.");
      return;
    }
    if (options.dryRun) {
      console.log(`Pendientes: ${pending.map((migration) => migration.id).join(", ")}`);
      return;
    }

    for (const migration of pending) {
      console.log(`Aplicando ${migration.id}…`);
      const sql = stripBreakpoints(readFileSync(migration.path, "utf8"));
      await runtime.d1.exec(
        `${sql}\nINSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', '${new Date().toISOString()}');`,
      );
    }
    console.log(`Aplicadas ${pending.length} migración(es).`);
  } finally {
    await runtime.cleanup();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  runMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
