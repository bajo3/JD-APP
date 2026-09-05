import assert from "node:assert/strict";
import test from "node:test";

import {
  DRILL_TABLES,
  compareCounts,
  dumpTableRows,
  parseArgs as parseBackupArgs,
  readSchemaTables,
  topologicalTableOrder,
} from "../scripts/d1-backup.mjs";
import { parseArgs as parseMigrateArgs, pendingMigrations } from "../scripts/d1-migrate.mjs";

test("destructive database operations demand an explicit flag", () => {
  assert.throws(() => parseBackupArgs(["--restore", "dump.sql"]), /--confirm-restore/);
  assert.throws(() => parseBackupArgs(["--restore"]), /needs the path/);
  assert.throws(() => parseMigrateArgs(["--remote"]), /--confirm-remote/);

  const safe = parseBackupArgs(["--drill"]);
  assert.equal(safe.restore, null);
  assert.equal(safe.drill, true);

  // Un volcado o un ensayo son de lectura (o tocan sólo un esquema propio y
  // descartable), así que no piden confirmación: sólo restaurar la pisa.
  const restore = parseBackupArgs(["--restore", "dump.sql", "--confirm-restore"]);
  assert.equal(restore.restore, "dump.sql");
});

test("un volcado sin filas no genera ninguna sentencia", () => {
  assert.equal(dumpTableRows("vehicle", []), "");
});

test("un volcado escapa comillas, respeta null y conserva el orden de columnas", () => {
  const sql = dumpTableRows("lead", [
    { id: "lead-1", name: "O'Higgins", notes: null, priceCents: 1234, active: true },
  ]);
  assert.match(sql, /^INSERT INTO "lead" \("id", "name", "notes", "priceCents", "active"\) VALUES/);
  assert.match(sql, /'O''Higgins'/);
  assert.match(sql, /NULL/);
  assert.match(sql, /1234/);
  assert.match(sql, /TRUE/);
  assert.ok(sql.trim().endsWith(";"));
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

test("el orden de volcado nunca inserta una fila antes que la que referencia", () => {
  const order = topologicalTableOrder();
  assert.deepEqual([...order].sort(), [...DRILL_TABLES].sort());

  const position = new Map(order.map((table, index) => [table, index]));
  // lead_interest depende de lead, vehicle, appraisal, simulation y promotion:
  // todas tienen que quedar antes en el orden de inserción.
  for (const dependency of ["lead", "vehicle", "appraisal", "simulation", "promotion"]) {
    assert.ok(
      position.get(dependency) < position.get("lead_interest"),
      `${dependency} debería insertarse antes que lead_interest`,
    );
  }
  assert.ok(position.get("vehicle") < position.get("vehicle_price_history"));
  assert.ok(position.get("appraisal") < position.get("appraisal_media"));
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
