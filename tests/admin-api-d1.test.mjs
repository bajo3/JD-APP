import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function migration(path) {
  return readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", "");
}

function cleanAdminDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(migration("drizzle/0000_chemical_tiger_shark.sql"));
  db.exec(migration("drizzle/0001_worried_valkyrie.sql"));
  db.exec(migration("drizzle/0002_seed_demo_publication.sql"));
  db.exec(migration("drizzle/0004_furry_ultimatum.sql"));
  return db;
}

test("admin migration adds lock versions, idempotency, audit indexes and keeps DEMO data explicit", () => {
  const db = cleanAdminDatabase();
  const lock = db.prepare(
    "SELECT lock_version FROM finance_plan_version WHERE id = 'finance-plan-demo-preview'",
  ).get();
  assert.equal(lock.lock_version, 1);
  const tables = db.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'admin_%' ORDER BY name",
  ).all().map((row) => row.name);
  assert.deepEqual(tables, ["admin_audit_log", "admin_idempotency"]);
  assert.equal(
    db.prepare("SELECT is_demo FROM finance_plan_version WHERE id = 'finance-plan-demo-preview'").get().is_demo,
    1,
  );
  assert.match(
    db.prepare("SELECT disclaimer FROM finance_plan_version WHERE id = 'finance-plan-demo-preview'").get().disclaimer,
    /DEMO|fictici/i,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

  const plan = db.prepare(
    "EXPLAIN QUERY PLAN SELECT * FROM admin_audit_log WHERE resource_type = ? AND resource_id = ? ORDER BY occurred_at DESC",
  ).all("vehicle", "veh-tcross-2022").map((row) => row.detail).join(" ");
  assert.match(plan, /idx_admin_audit_resource_occurred/);
});

test("idempotency keys are unique per create scope", () => {
  const db = cleanAdminDatabase();
  const insert = db.prepare(
    `INSERT INTO admin_idempotency
     (id, scope, idempotency_key, request_hash, resource_type, resource_id, actor_user_id)
     VALUES (?, 'vehicle.create', 'vehicle:key:1', ?, 'vehicle', ?, 'operator-1')
     ON CONFLICT(scope, idempotency_key) DO NOTHING`,
  );
  assert.equal(insert.run("idem-1", "hash-a", "vehicle-a").changes, 1);
  assert.equal(insert.run("idem-2", "hash-a", "vehicle-b").changes, 0);
  const winner = db.prepare(
    "SELECT request_hash, resource_id FROM admin_idempotency WHERE scope = 'vehicle.create' AND idempotency_key = 'vehicle:key:1'",
  ).get();
  assert.equal(winner.request_hash, "hash-a");
  assert.equal(winner.resource_id, "vehicle-a");
});

test("a stale optimistic update writes neither a second change nor a false audit event", () => {
  const db = cleanAdminDatabase();
  const update = db.prepare(
    "UPDATE vehicle SET status = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
  );
  const audit = db.prepare(
    `INSERT INTO admin_audit_log
     (id, actor_user_id, actor_email, action, resource_type, resource_id,
      previous_version, next_version, summary_json, occurred_at)
     SELECT ?, 'operator-1', 'operator@example.com', 'VEHICLE_PUBLISHED', 'vehicle', ?, 1, 2, '{}', ?
     WHERE changes() > 0`,
  );

  db.exec("BEGIN IMMEDIATE");
  assert.equal(update.run("AVAILABLE", 2, "2026-08-16T15:00:00.000Z", "veh-tcross-2022", 1).changes, 1);
  assert.equal(audit.run("audit-success", "veh-tcross-2022", "2026-08-16T15:00:00.000Z").changes, 1);
  db.exec("COMMIT");

  db.exec("BEGIN IMMEDIATE");
  assert.equal(update.run("SOLD", 2, "2026-08-16T15:01:00.000Z", "veh-tcross-2022", 1).changes, 0);
  assert.equal(audit.run("audit-stale", "veh-tcross-2022", "2026-08-16T15:01:00.000Z").changes, 0);
  db.exec("COMMIT");

  assert.equal(db.prepare("SELECT status FROM vehicle WHERE id = 'veh-tcross-2022'").get().status, "AVAILABLE");
  assert.equal(db.prepare("SELECT count(*) AS count FROM admin_audit_log").get().count, 1);
});
