import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = Object.freeze({});", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(resolve(
          projectRoot,
          specifier === "@/db"
            ? "db/index.ts"
            : specifier === "@/lib/admin"
              ? "lib/admin/index.ts"
            : relative.endsWith(".mjs") ? relative : `${relative}.ts`,
        )).href,
        shortCircuit: true,
      };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return {
        format: "module",
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
          mode: "transform",
          sourceMap: false,
        }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const {
  adminVehicleMediaCollection,
  adminVehicleMediaItem,
  publicVehicleMedia,
} = await import("../lib/server/vehicle-media.ts");
const { D1VehicleMediaRepository } = await import("../lib/data/vehicle-media-repository.ts");
const { SupabaseObjectStore } = await import("../lib/data/storage.ts");

const VEHICLE_ID = "vehicle-1";
const AT = new Date("2026-08-17T15:00:00.000Z");
const previousAllowlist = process.env.PANEL_ALLOWED_EMAILS;
const previousAccountIds = process.env.PANEL_ALLOWED_ACCOUNT_IDS;
process.env.PANEL_ALLOWED_EMAILS = "admin@example.com";
process.env.PANEL_ALLOWED_ACCOUNT_IDS = "user-1";
test.after(() => {
  if (previousAllowlist === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
  else process.env.PANEL_ALLOWED_EMAILS = previousAllowlist;
  if (previousAccountIds === undefined) delete process.env.PANEL_ALLOWED_ACCOUNT_IDS;
  else process.env.PANEL_ALLOWED_ACCOUNT_IDS = previousAccountIds;
});

const adminAuth = Object.freeze({
  async readSession() {
    return {
      id: "user-1", email: "admin@example.com", name: "Operador", phoneNormalized: null,
      leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
      lastLoginAt: null, version: 1, createdAt: AT.toISOString(),
    };
  },
});

function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}

function ascii(value) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function u32be(value) {
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
}

function pngChunk(type, data) {
  return concat(u32be(data.length), ascii(type), data, new Uint8Array(4));
}

function validPng() {
  const header = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0);
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Uint8Array.of(0)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function adminHeaders(extra = {}) {
  return {
    "Content-Type": "image/png",
    "Idempotency-Key": "vehicle-media-upload-001",
    "X-Alt-Text": "Vista frontal del vehículo",
    "X-Vehicle-Version": "1",
    "oai-authenticated-user-id": "user-1",
    "oai-authenticated-user-email": "admin@example.com",
    ...extra,
  };
}

function uploadRequest(bytes = validPng(), headers = {}) {
  return new Request(`http://localhost/api/v1/admin/vehicles/${VEHICLE_ID}/media`, {
    method: "POST",
    headers: adminHeaders(headers),
    body: bytes,
  });
}

function fakeBackend(options = {}) {
  let vehicleVersion = 1;
  let row = null;
  let replay = null;
  let putCount = 0;
  let deleteCount = 0;
  let auditCount = 0;
  const repository = {
    findVehicleVersion: async () => vehicleVersion,
    listAdmin: async () => row ? [row] : [],
    findUploadReplay: async (key, hash) => {
      if (!replay || replay.key !== key) return null;
      return replay.hash === hash ? row : "conflict";
    },
    async reserveUpload(input, context) {
      if (context.expectedVehicleVersion !== vehicleVersion) {
        return { ok: false, reason: "version_conflict", currentVersion: vehicleVersion };
      }
      if (row && row.sha256 === input.sha256) return { ok: false, reason: "duplicate" };
      vehicleVersion += 1;
      row = {
        id: input.mediaId,
        vehicleId: input.vehicleId,
        r2Key: input.r2Key,
        publicUrl: input.publicUrl,
        contentType: input.contentType,
        altText: input.altText,
        byteSize: input.byteSize,
        sha256: input.sha256,
        status: "PENDING",
        sortOrder: 0,
        width: null,
        height: null,
        version: 1,
        uploadedBy: context.actor.email,
        createdAt: context.occurredAt,
        updatedAt: context.occurredAt,
        archivedAt: null,
      };
      replay = { key: context.idempotencyKey, hash: context.requestHash };
      return { ok: true, record: row, vehicleVersion, replayed: false };
    },
    async markReady() {
      if (options.failReady) throw new Error("D1 unavailable");
      if (row.status !== "READY") auditCount += 1;
      row = { ...row, status: "READY", version: row.version + 1 };
      return row;
    },
    async markFailed() {
      row = { ...row, status: "FAILED", version: row.version + 1 };
    },
    async archive(_vehicleId, mediaId, expected) {
      if (!row || row.id !== mediaId) return { ok: false, reason: "not_found" };
      if (expected !== vehicleVersion) {
        return { ok: false, reason: "version_conflict", currentVersion: vehicleVersion };
      }
      vehicleVersion += 1;
      row = { ...row, status: "ARCHIVED", archivedAt: AT.toISOString(), version: row.version + 1 };
      return { ok: true, record: row, vehicleVersion };
    },
    async reorder(_vehicleId, orderedIds, expected) {
      if (expected !== vehicleVersion) {
        return { ok: false, reason: "version_conflict", currentVersion: vehicleVersion };
      }
      if (!row || orderedIds.length !== 1 || orderedIds[0] !== row.id) {
        return { ok: false, reason: "not_found" };
      }
      vehicleVersion += 1;
      return { ok: true, record: [row], vehicleVersion };
    },
    async findPublic(mediaId) {
      return options.vehicleAvailable !== false && row?.id === mediaId && row.status === "READY"
        ? row
        : null;
    },
  };
  const objects = {
    async putStockImage() {
      putCount += 1;
      if (options.failPut) throw new Error("R2 unavailable");
      return row.r2Key;
    },
    async deleteObject() { deleteCount += 1; },
    async getStockObject() {
      return { body: new Blob([validPng()]).stream() };
    },
    async putPrivateAppraisalImage() { throw new Error("not used"); },
    async getPrivateObject() { return null; },
  };
  return {
    runtime: { auth: adminAuth, repository, objects, now: AT, idGenerator: () => "media-1" },
    counts: () => ({ putCount, deleteCount, auditCount, rows: row ? 1 : 0 }),
    row: () => row,
    version: () => vehicleVersion,
  };
}

function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) {
        // node:sqlite no acepta un booleano nativo como bind: D1 real y el shim de
        // Postgres sí lo hacen, así que la base de pruebas en SQLite lo traduce acá.
        return statement(sql, values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
      },
      async first() { return database.prepare(sql).get(...bindings) ?? null; },
      async all() {
        return { results: database.prepare(sql).all(...bindings), success: true, meta: {} };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function mediaDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const path of [
    "drizzle-sqlite-archive/0000_chemical_tiger_shark.sql",
    "drizzle-sqlite-archive/0001_worried_valkyrie.sql",
    "drizzle-sqlite-archive/0002_seed_demo_publication.sql",
    "drizzle-sqlite-archive/0004_furry_ultimatum.sql",
    "drizzle-sqlite-archive/0005_lucky_exiles.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database.prepare(
    `INSERT INTO vehicle
     (id, slug, make, model, trim, year, mileage_km, price_cents, currency,
      body_type, fuel_type, transmission, color, status, source, version)
     VALUES (?, ?, 'Marca', 'Modelo', 'Base', 2025, 0, 100000, 'ARS',
             'car', 'Nafta', 'Manual', 'Blanco', 'AVAILABLE', 'test', 1)`,
  ).run(VEHICLE_ID, "vehicle-media-test");
  return database;
}

test("media migration backfills distinct legacy hashes and keeps them fail-closed", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const path of [
    "drizzle-sqlite-archive/0000_chemical_tiger_shark.sql",
    "drizzle-sqlite-archive/0001_worried_valkyrie.sql",
    "drizzle-sqlite-archive/0002_seed_demo_publication.sql",
    "drizzle-sqlite-archive/0004_furry_ultimatum.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  const insert = database.prepare(
    `INSERT INTO vehicle_media
     (id, vehicle_id, r2_key, public_url, content_type, alt_text, sort_order)
     VALUES (?, 'veh-tcross-2022', ?, ?, 'image/jpeg', 'Foto legacy', ?)`,
  );
  insert.run("legacy-media-1", "public/stock/legacy/1", "/legacy/1", 0);
  insert.run("legacy-media-2", "public/stock/legacy/2", "/legacy/2", 1);
  database.exec(readFileSync("drizzle-sqlite-archive/0005_lucky_exiles.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
  assert.deepEqual(
    database.prepare(
      "SELECT sha256, status FROM vehicle_media WHERE vehicle_id = 'veh-tcross-2022' ORDER BY id",
    ).all().map((row) => ({ sha256: row.sha256, status: row.status })),
    [
      { sha256: "legacy:legacy-media-1", status: "PENDING" },
      { sha256: "legacy:legacy-media-2", status: "PENDING" },
    ],
  );
});

test("R2 stock adapter rejects HEIC before accessing a bucket", async () => {
  await assert.rejects(
    () => new SupabaseObjectStore().putStockImage({
      vehicleId: VEHICLE_ID,
      mediaId: "media-heic",
      body: new Uint8Array([1]),
      contentType: "image/heic",
      byteSize: 1,
      sha256: "0".repeat(64),
    }),
    /UNSUPPORTED_STOCK_IMAGE_TYPE/,
  );
});

test("anonymous upload fails closed without writing D1 or R2", async () => {
  const backend = fakeBackend();
  const response = await adminVehicleMediaCollection(
    new Request(`http://localhost/api/v1/admin/vehicles/${VEHICLE_ID}/media`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: validPng(),
    }),
    VEHICLE_ID,
    { ...backend.runtime, auth: undefined },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(backend.counts(), { putCount: 0, deleteCount: 0, auditCount: 0, rows: 0 });
});

test("valid upload becomes READY and identical replay creates no duplicate or audit", async () => {
  const backend = fakeBackend();
  const created = await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, backend.runtime);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("X-Vehicle-Version"), "2");
  assert.equal((await created.json()).data.status, "READY");
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, auditCount: 1, rows: 1 });

  const replay = await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, backend.runtime);
  assert.equal(replay.status, 200);
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, auditCount: 1, rows: 1 });
});

test("D1 and fake R2 complete one atomic upload, audit and idempotent replay", async () => {
  const database = mediaDatabase();
  const repository = new D1VehicleMediaRepository(sqliteD1(database));
  let puts = 0;
  const objects = {
    async putStockImage(input) { puts += 1; return `public/stock/${input.vehicleId}/${input.mediaId}`; },
    async deleteObject() {},
    async getStockObject() { return { body: new Blob([validPng()]).stream() }; },
  };
  const runtime = { auth: adminAuth, repository, objects, now: AT, idGenerator: () => "media-d1-1" };
  const created = await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, runtime);
  assert.equal(created.status, 201);
  assert.equal(database.prepare("SELECT status FROM vehicle_media WHERE id = 'media-d1-1'").get().status, "READY");
  assert.equal(database.prepare("SELECT count(*) count FROM admin_audit_log WHERE action = 'vehicle_media.upload'").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM admin_idempotency WHERE scope = 'vehicle_media.upload'").get().count, 1);

  const replay = await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, runtime);
  assert.equal(replay.status, 200);
  assert.equal(puts, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM vehicle_media").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM admin_audit_log WHERE action = 'vehicle_media.upload'").get().count, 1);
  assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("invalid signature and version conflict leave object storage untouched", async () => {
  const invalidBackend = fakeBackend();
  const invalid = await adminVehicleMediaCollection(
    uploadRequest(Uint8Array.of(1, 2, 3, 4)),
    VEHICLE_ID,
    invalidBackend.runtime,
  );
  assert.equal(invalid.status, 422);
  assert.equal(invalidBackend.counts().putCount, 0);

  const conflictBackend = fakeBackend();
  const conflict = await adminVehicleMediaCollection(
    uploadRequest(validPng(), { "X-Vehicle-Version": "9" }),
    VEHICLE_ID,
    conflictBackend.runtime,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "ADMIN_VERSION_CONFLICT");
  assert.equal(conflictBackend.counts().putCount, 0);
});

test("binary upload enforces the 5 MiB limit before metadata or R2 writes", async () => {
  const backend = fakeBackend();
  const response = await adminVehicleMediaCollection(
    uploadRequest(new Uint8Array(5 * 1024 * 1024 + 1)),
    VEHICLE_ID,
    backend.runtime,
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "STOCK_IMAGE_TOO_LARGE");
  assert.deepEqual(backend.counts(), { putCount: 0, deleteCount: 0, auditCount: 0, rows: 0 });
});

test("D1 confirmation failure compensates the R2 object and marks metadata FAILED", async () => {
  const backend = fakeBackend({ failReady: true });
  const response = await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, backend.runtime);
  assert.equal(response.status, 503);
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 1, auditCount: 0, rows: 1 });
  assert.equal(backend.row().status, "FAILED");
});

test("public delivery is conditional, typed and withdrawn after logical archive", async () => {
  const backend = fakeBackend();
  await adminVehicleMediaCollection(uploadRequest(), VEHICLE_ID, backend.runtime);
  const delivered = await publicVehicleMedia(
    new Request("http://localhost/api/v1/media/vehicles/media-1"),
    "media-1",
    backend.runtime,
  );
  assert.equal(delivered.status, 200);
  assert.equal(delivered.headers.get("Content-Type"), "image/png");
  assert.equal(delivered.headers.get("Content-Disposition"), "inline");
  assert.equal(delivered.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(delivered.headers.get("ETag"), /^"[a-f0-9]{64}"$/);
  const notModified = await publicVehicleMedia(
    new Request("http://localhost/api/v1/media/vehicles/media-1", {
      headers: { "If-None-Match": delivered.headers.get("ETag") },
    }),
    "media-1",
    backend.runtime,
  );
  assert.equal(notModified.status, 304);

  const listed = await adminVehicleMediaCollection(
    new Request(`http://localhost/api/v1/admin/vehicles/${VEHICLE_ID}/media`, {
      headers: adminHeaders(),
    }),
    VEHICLE_ID,
    backend.runtime,
  );
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).data.length, 1);

  const archived = await adminVehicleMediaItem(
    new Request(`http://localhost/api/v1/admin/vehicles/${VEHICLE_ID}/media/media-1`, {
      method: "PATCH",
      headers: adminHeaders({ "Content-Type": "application/json", "X-Vehicle-Version": "2" }),
      body: JSON.stringify({ action: "archive" }),
    }),
    VEHICLE_ID,
    "media-1",
    backend.runtime,
  );
  assert.equal(archived.status, 200);
  assert.equal(backend.row().status, "ARCHIVED");
  const unavailable = await publicVehicleMedia(
    new Request("http://localhost/api/v1/media/vehicles/media-1"),
    "media-1",
    backend.runtime,
  );
  assert.equal(unavailable.status, 404);
});
