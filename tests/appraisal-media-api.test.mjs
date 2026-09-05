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

const { publicAppraisalPhotoUpload, adminAppraisalPhotoList, adminAppraisalPhotoBytes } =
  await import("../lib/server/appraisal-media.ts");
const { D1AppraisalMediaRepository } = await import("../lib/data/appraisal-media-repository.ts");
const { digestImageSha256 } = await import("../lib/media/index.mjs");

const AT = new Date("2026-08-18T12:00:00.000Z");
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

function jpegSegment(marker, data) {
  const length = data.length + 2;
  return concat(Uint8Array.of(0xff, marker, length >>> 8, length & 0xff), data);
}

function jpegWithGps() {
  return concat(
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, concat(ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0))),
    jpegSegment(0xe1, concat(ascii("Exif\0\0"), ascii("MM\x00\x2aGPS:-37.32144"))),
    jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
    Uint8Array.of(0x12, 0x34),
    Uint8Array.of(0xff, 0xd9),
  );
}

function uploadRequest(bytes = jpegWithGps(), headers = {}) {
  return new Request("http://localhost/api/v1/appraisals/TAS-ABC123/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "Idempotency-Key": "appraisal-photo-001",
      "X-Capture-Type": "FRONT",
      ...headers,
    },
    body: bytes,
  });
}

function adminHeaders(extra = {}) {
  return {
    "oai-authenticated-user-id": "user-1",
    "oai-authenticated-user-email": "admin@example.com",
    ...extra,
  };
}

function fakeBackend(options = {}) {
  const appraisal = { id: "appraisal-1", status: options.status ?? "SUBMITTED" };
  const rows = new Map();
  const idempotency = new Map();
  let putCount = 0;
  let deleteCount = 0;
  const stored = {};
  const repository = {
    findAppraisalByPublicCode: async (code) =>
      code === "TAS-ABC123" ? appraisal : null,
    findAppraisalById: async (id) => (id === appraisal.id ? appraisal : null),
    listByAppraisal: async (id) =>
      id === appraisal.id ? [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder) : [],
    findByMediaId: async (id, mediaId) => (id === appraisal.id ? rows.get(mediaId) ?? null : null),
    findUploadReplay: async (key, hash) => {
      const existing = idempotency.get(key);
      if (!existing) return null;
      if (existing.hash !== hash) return "conflict";
      return rows.get(existing.mediaId) ?? null;
    },
    insertUpload: async (input, context) => {
      const existing = idempotency.get(context.idempotencyKey);
      if (existing) {
        if (existing.hash !== context.requestHash) return { ok: false, reason: "duplicate" };
        return { ok: true, record: rows.get(existing.mediaId), replayed: true };
      }
      if (appraisal.status !== "SUBMITTED") return { ok: false, reason: "appraisal_closed" };
      for (const row of rows.values()) {
        if (row.captureType === input.captureType) {
          return { ok: false, reason: "capture_occupied" };
        }
      }
      const record = {
        id: input.mediaId,
        appraisalId: input.appraisalId,
        r2Key: input.r2Key,
        contentType: input.contentType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        captureType: input.captureType,
        sortOrder: { FRONT: 0, REAR: 1, SIDE_LEFT: 2, SIDE_RIGHT: 3, INTERIOR: 4, DASHBOARD: 5 }[input.captureType],
        uploadedAt: context.occurredAt,
        createdAt: context.occurredAt,
      };
      rows.set(record.id, record);
      idempotency.set(context.idempotencyKey, { hash: context.requestHash, mediaId: record.id });
      return { ok: true, record, replayed: false };
    },
    deleteById: async (mediaId) => {
      rows.delete(mediaId);
      deleteCount += 1;
    },
  };
  const objects = {
    async putPrivateAppraisalImage(input) {
      putCount += 1;
      if (options.failPut) throw new Error("R2 unavailable");
      stored[input.mediaId] = input;
      return input.mediaId;
    },
    async getPrivateObject(key) {
      const mediaId = key.split("/").pop();
      return stored[mediaId]
        ? { body: new Blob([stored[mediaId].body]).stream() }
        : null;
    },
    async deleteObject() {},
  };
  return {
    runtime: { auth: adminAuth, repository, objects, now: AT, idGenerator: () => "media-1" },
    counts: () => ({ putCount, deleteCount, rows: rows.size }),
    rows: () => [...rows.values()],
    storedBody: () => stored["media-1"]?.body,
  };
}

test("public upload strips metadata, stores private bytes and returns 201", async () => {
  const backend = fakeBackend();
  const response = await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.captureType, "FRONT");
  assert.equal(payload.data.byteSize, backend.storedBody().byteLength);
  assert.equal(payload.data.sha256, await digestImageSha256(backend.storedBody()));
  const decoded = new TextDecoder().decode(backend.storedBody());
  assert.equal(decoded.includes("GPS"), false);
  assert.equal(backend.counts().putCount, 1);
});

test("identical replay returns 200 without a second object or row", async () => {
  const backend = fakeBackend();
  await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  const replay = await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, rows: 1 });
});

test("same idempotency key with a different photo conflicts", async () => {
  const backend = fakeBackend();
  await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  const conflict = await publicAppraisalPhotoUpload(
    uploadRequest(jpegWithGps(), { "X-Capture-Type": "REAR" }),
    "TAS-ABC123",
    { ...backend.runtime, auth: undefined },
  );
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.equal(body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, rows: 1 });
});

test("one photo per capture slot and closed appraisals reject uploads", async () => {
  const occupied = fakeBackend();
  await publicAppraisalPhotoUpload(
    uploadRequest(),
    "TAS-ABC123",
    occupied.runtime,
  );
  const second = await publicAppraisalPhotoUpload(
    uploadRequest(jpegWithGps(), { "Idempotency-Key": "appraisal-photo-002" }),
    "TAS-ABC123",
    occupied.runtime,
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "APPRAISAL_CAPTURE_OCCUPIED");

  const closed = fakeBackend({ status: "IN_REVIEW" });
  const response = await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", closed.runtime);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "APPRAISAL_UPLOAD_CLOSED");
});

test("invalid code, type, size, capture and missing key fail closed", async () => {
  const backend = fakeBackend();

  const unknown = await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ZZZ999", backend.runtime);
  assert.equal(unknown.status, 404);

  const heic = await publicAppraisalPhotoUpload(
    uploadRequest(jpegWithGps(), { "Content-Type": "image/heic" }),
    "TAS-ABC123",
    { ...backend.runtime, auth: undefined },
  );
  assert.equal(heic.status, 415);

  const badCapture = await publicAppraisalPhotoUpload(
    uploadRequest(jpegWithGps(), { "X-Capture-Type": "MOTOR" }),
    "TAS-ABC123",
    backend.runtime,
  );
  assert.equal(badCapture.status, 422);

  const noKey = await publicAppraisalPhotoUpload(
    uploadRequest(jpegWithGps(), { "Idempotency-Key": "" }),
    "TAS-ABC123",
    backend.runtime,
  );
  assert.equal(noKey.status, 400);

  const malformed = new Uint8Array([1, 2, 3, 4, 5]);
  const invalidBytes = await publicAppraisalPhotoUpload(
    uploadRequest(malformed),
    "TAS-ABC123",
    backend.runtime,
  );
  assert.equal(invalidBytes.status, 422);

  assert.deepEqual(backend.counts(), { putCount: 0, deleteCount: 0, rows: 0 });
});

test("storage failure compensates by removing the dangling row", async () => {
  const backend = fakeBackend({ failPut: true });
  const response = await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  assert.equal(response.status, 503);
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 1, rows: 0 });
});

test("admin photo listing and bytes delivery require an authenticated panel user", async () => {
  const backend = fakeBackend();
  await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);

  const anonList = await adminAppraisalPhotoList(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos"),
    "appraisal-1",
    { ...backend.runtime, auth: undefined },
  );
  assert.equal(anonList.status, 401);

  const anonBytes = await adminAppraisalPhotoBytes(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos/media-1"),
    "appraisal-1",
    "media-1",
    { ...backend.runtime, auth: undefined },
  );
  assert.equal(anonBytes.status, 401);

  const list = await adminAppraisalPhotoList(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos", {
      headers: adminHeaders(),
    }),
    "appraisal-1",
    backend.runtime,
  );
  assert.equal(list.status, 200);
  const payload = await list.json();
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].url, "/api/v1/admin/appraisals/appraisal-1/photos/media-1");
  assert.equal("r2Key" in payload.data[0], false);

  const bytes = await adminAppraisalPhotoBytes(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos/media-1", {
      headers: adminHeaders(),
    }),
    "appraisal-1",
    "media-1",
    backend.runtime,
  );
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("Content-Type"), "image/jpeg");
  assert.equal(bytes.headers.get("Cache-Control"), "private, no-store");

  const missing = await adminAppraisalPhotoBytes(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos/nope", {
      headers: adminHeaders(),
    }),
    "appraisal-1",
    "nope",
    backend.runtime,
  );
  assert.equal(missing.status, 404);
});

test("a denied panel account cannot read appraisal metadata or private bytes", async () => {
  const backend = fakeBackend();
  await publicAppraisalPhotoUpload(uploadRequest(), "TAS-ABC123", backend.runtime);
  let repositoryCalls = 0;
  const guardedRepository = new Proxy(backend.runtime.repository, {
    get(target, property, receiver) {
      if (property === "findAppraisalById" || property === "findByMediaId") {
        return async () => {
          repositoryCalls += 1;
          throw new Error("private data read before authorization");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const deniedAuth = {
    allowedEmails: "admin@example.com",
    allowedAccountIds: "another-account",
    async readSession() {
      return {
        id: "user-1", email: "admin@example.com", name: "Operador", phoneNormalized: null,
        leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
        lastLoginAt: null, version: 1, createdAt: AT.toISOString(),
      };
    },
  };
  const list = await adminAppraisalPhotoList(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos"),
    "appraisal-1",
    { ...backend.runtime, auth: deniedAuth, repository: guardedRepository },
  );
  const bytes = await adminAppraisalPhotoBytes(
    new Request("http://localhost/api/v1/admin/appraisals/appraisal-1/photos/media-1"),
    "appraisal-1",
    "media-1",
    { ...backend.runtime, auth: deniedAuth, repository: guardedRepository },
  );
  assert.equal(list.status, 403);
  assert.equal(bytes.status, 403);
  assert.equal(repositoryCalls, 0);
});

function sqliteD1(database) {
  function statement(sql, bindings = []) {
    return {
      bind(...values) { return statement(sql, values); },
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

function appraisalDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0001_worried_valkyrie.sql",
    "drizzle/0002_seed_demo_publication.sql",
    "drizzle/0004_furry_ultimatum.sql",
    "drizzle/0007_appraisal_media_capture.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database.prepare(
    `INSERT INTO appraisal
     (id, public_code, idempotency_key, make, model, year, mileage_km,
      declared_condition, status, certainty_level)
     VALUES ('appraisal-1', 'TAS-ABC123', 'seed', 'Toyota', 'Corolla', 2020, 50000,
             'GOOD', 'SUBMITTED', 'T0')`,
  ).run();
  return database;
}

test("repository enforces capture slots, closed status and replay against real SQL", async () => {
  const repository = new D1AppraisalMediaRepository(sqliteD1(appraisalDatabase()));

  const found = await repository.findAppraisalByPublicCode("TAS-ABC123");
  assert.deepEqual(found, { id: "appraisal-1", status: "SUBMITTED" });

  const first = await repository.insertUpload(
    {
      mediaId: "media-1",
      appraisalId: "appraisal-1",
      r2Key: "private/appraisals/appraisal-1/media-1",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-1", requestHash: "hash-1", occurredAt: AT.toISOString() },
  );
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(first.record.sortOrder, 0);

  const replay = await repository.insertUpload(
    {
      mediaId: "media-2",
      appraisalId: "appraisal-1",
      r2Key: "private/appraisals/appraisal-1/media-2",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-1", requestHash: "hash-1", occurredAt: AT.toISOString() },
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, "media-1");

  const occupied = await repository.insertUpload(
    {
      mediaId: "media-3",
      appraisalId: "appraisal-1",
      r2Key: "private/appraisals/appraisal-1/media-3",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "b".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-2", requestHash: "hash-2", occurredAt: AT.toISOString() },
  );
  assert.deepEqual(occupied, { ok: false, reason: "capture_occupied" });

  const conflict = await repository.insertUpload(
    {
      mediaId: "media-4",
      appraisalId: "appraisal-1",
      r2Key: "private/appraisals/appraisal-1/media-4",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "c".repeat(64),
      captureType: "REAR",
    },
    { idempotencyKey: "key-1", requestHash: "hash-other", occurredAt: AT.toISOString() },
  );
  assert.deepEqual(conflict, { ok: false, reason: "duplicate" });

  const listed = await repository.listByAppraisal("appraisal-1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].captureType, "FRONT");
});
