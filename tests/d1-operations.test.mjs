import assert from "node:assert/strict";
import test from "node:test";

import {
  DRILL_TABLES,
  compareCounts,
  normalizeDump,
  parseArgs as parseBackupArgs,
  parseCounts,
  readSchemaTables,
  splitStatements,
} from "../scripts/d1-backup.mjs";
import {
  parseAppliedIds,
  parseArgs as parseMigrateArgs,
  pendingMigrations,
} from "../scripts/d1-migrate.mjs";

const LF = String.fromCharCode(10);

test("destructive database operations demand an explicit flag", () => {
  assert.throws(() => parseBackupArgs(["--remote"]), /--confirm-remote/);
  assert.throws(() => parseBackupArgs(["--restore", "dump.sql"]), /--confirm-restore/);
  assert.throws(() => parseBackupArgs(["--restore"]), /needs the path/);
  assert.throws(() => parseMigrateArgs(["--remote"]), /--confirm-remote/);
  assert.throws(() => parseBackupArgs(["--database", "DB; DROP TABLE lead"]), /Invalid D1/);

  const safe = parseBackupArgs(["--drill"]);
  assert.equal(safe.remote, false);
  assert.equal(safe.restore, null);
  assert.equal(safe.drill, true);
});

test("a dump is reordered so every row lands after its table exists", () => {
  const dump = [
    "PRAGMA defer_foreign_keys=TRUE;",
    "CREATE TABLE `appraisal_media` (",
    "\t`id` text PRIMARY KEY NOT NULL,",
    "\tFOREIGN KEY (`appraisal_id`) REFERENCES `appraisal`(`id`)",
    ");",
    "INSERT INTO \"appraisal_media\" VALUES('a','b');",
    "CREATE TABLE `appraisal` (",
    "\t`id` text PRIMARY KEY NOT NULL",
    ");",
    "INSERT INTO \"appraisal\" VALUES('b');",
    "CREATE UNIQUE INDEX `uq_media` ON `appraisal_media` (`id`);",
  ].join(LF);

  const statements = splitStatements(normalizeDump(dump));
  const kind = statements.map((statement) =>
    statement.startsWith("PRAGMA")
      ? "pragma"
      : statement.startsWith("CREATE UNIQUE INDEX")
        ? "index"
        : statement.startsWith("CREATE TABLE")
          ? "table"
          : "insert",
  );
  assert.deepEqual(kind, ["pragma", "table", "table", "insert", "insert", "index"]);
  assert.equal(statements.length, 6);
});

test("statement splitting survives semicolons and newlines inside values", () => {
  const dump = [
    "INSERT INTO \"lead\" VALUES('uno; dos',",
    "'tres');",
    "INSERT INTO \"lead\" VALUES('it''s fine; really');",
  ].join(LF);

  const statements = splitStatements(dump);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /uno; dos/);
  assert.match(statements[1], /it''s fine; really/);
});

test("restore drill compares the tables that carry the operation", () => {
  const source = Object.fromEntries(DRILL_TABLES.map((table) => [table, 3]));
  assert.deepEqual(compareCounts(source, { ...source }), []);

  const missing = { ...source, simulation: 2 };
  const drift = compareCounts(source, missing);
  assert.equal(drift.length, 1);
  assert.match(drift[0], /simulation: origen 3 vs restaurado 2/);

  assert.ok(DRILL_TABLES.includes("simulation"));
  assert.ok(DRILL_TABLES.includes("lead"));
  assert.ok(DRILL_TABLES.includes("admin_audit_log"));
});

test("el ensayo compara el esquema completo y no una lista escrita a mano", () => {
  // La lista sale del snapshot vigente de Drizzle: una migración nueva no puede
  // dejar una tabla fuera del ensayo sin que esta prueba lo note.
  assert.deepEqual(DRILL_TABLES, readSchemaTables());

  // Tablas que antes quedaban fuera y sostienen evidencia legal, fotos,
  // historial del lead y auditoría de precios.
  for (const table of [
    "consent",
    "appraisal_media",
    "lead_event",
    "lead_interest",
    "vehicle_price_history",
    "promotion_vehicle",
  ]) {
    assert.ok(DRILL_TABLES.includes(table), `${table} quedó fuera del ensayo de restauración`);
  }
});

test("wrangler JSON output is read defensively", () => {
  const counts = parseCounts('noise\n[{"results":[{"vehicle":4,"lead":0}],"success":true}]');
  assert.deepEqual(counts, { vehicle: 4, lead: 0 });
  assert.deepEqual(parseCounts("not json at all"), {});
  assert.deepEqual(parseCounts("[broken"), {});

  const ids = parseAppliedIds('[{"results":[{"id":"0001_a"},{"id":"0002_b"}],"success":true}]');
  assert.deepEqual(ids, ["0001_a", "0002_b"]);
  assert.deepEqual(parseAppliedIds(""), []);
});

test("only unapplied migrations run, and a baseline marks the older ones", () => {
  const all = [
    { id: "0000_a", path: "a" },
    { id: "0001_b", path: "b" },
    { id: "0002_c", path: "c" },
  ];
  assert.deepEqual(
    pendingMigrations(all, [], null).map((migration) => migration.id),
    ["0000_a", "0001_b", "0002_c"],
  );
  assert.deepEqual(
    pendingMigrations(all, ["0000_a"], null).map((migration) => migration.id),
    ["0001_b", "0002_c"],
  );
  assert.deepEqual(
    pendingMigrations(all, [], "0001_b").map((migration) => migration.id),
    ["0002_c"],
  );
  assert.throws(() => pendingMigrations(all, [], "0009_missing"), /not a known migration/);
});
