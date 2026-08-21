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

const { publicConsignmentPhotoUpload, adminConsignmentPhotoList, adminConsignmentPhotoBytes } =
  await import("../lib/server/consignment-media.ts");
const { D1ConsignmentMediaRepository } = await import("../lib/data/consignment-media-repository.ts");
const { digestImageSha256 } = await import("../lib/media/index.mjs");

const AT = new Date("2026-08-19T12:00:00.000Z");
const UPLOAD_TOKEN = "consignment-upload-token-example-256bits-aaaaaaaaa";
const UPLOAD_TOKEN_HASH = await digestImageSha256(new TextEncoder().encode(UPLOAD_TOKEN));
const previousAllowlist = process.env.PANEL_ALLOWED_EMAILS;
process.env.PANEL_ALLOWED_EMAILS = "admin@example.com";
test.after(() => {
  if (previousAllowlist === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
  else process.env.PANEL_ALLOWED_EMAILS = previousAllowlist;
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
  return new Request("http://localhost/api/v1/consignments/CON-ABC123/photos", {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "Idempotency-Key": "consignment-photo-001",
      "X-Capture-Type": "FRONT",
      Authorization: `Bearer ${UPLOAD_TOKEN}`,
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
  const consignment = {
    id: "consignment-1",
    status: options.status ?? "SUBMITTED",
    uploadTokenHash: options.uploadTokenHash === undefined ? UPLOAD_TOKEN_HASH : options.uploadTokenHash,
  };
  const rows = new Map();
  const idempotency = new Map();
  let putCount = 0;
  let deleteCount = 0;
  let archived = [];
  const stored = {};
  const repository = {
    findConsignmentByPublicCode: async (code) =>
      code === "CON-ABC123" ? consignment : null,
    findConsignmentById: async (id) => (id === consignment.id ? consignment : null),
    listReadyByConsignment: async (id) =>
      id === consignment.id
        ? [...rows.values()].filter((row) => row.status === "READY").sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    countReadyByConsignment: async (id) =>
      [...rows.values()].filter((row) => row.consignmentId === id && row.status === "READY").length,
    findReadyByMediaId: async (id, mediaId) => {
      const row = rows.get(mediaId);
      return row && row.consignmentId === id && row.status === "READY" ? row : null;
    },
    findByMediaId: async (id, mediaId) => {
      const row = rows.get(mediaId);
      return row && row.consignmentId === id ? row : null;
    },
    findUploadReplay: async (key, hash) => {
      const existing = idempotency.get(key);
      if (!existing) return null;
      if (existing.hash !== hash) return "conflict";
      const row = rows.get(existing.mediaId);
      return row && row.status !== "ARCHIVED" ? row : null;
    },
    insertUpload: async (input, context) => {
      const existing = idempotency.get(context.idempotencyKey);
      if (existing) {
        if (existing.hash !== context.requestHash) return { ok: false, reason: "duplicate" };
        return { ok: true, record: rows.get(existing.mediaId), replayed: true };
      }
      if (consignment.status !== "SUBMITTED") return { ok: false, reason: "consignment_closed" };
      for (const row of rows.values()) {
        if (row.captureType === input.captureType && row.status !== "ARCHIVED") {
          return { ok: false, reason: "capture_occupied" };
        }
      }
      const record = {
        id: input.mediaId,
        consignmentId: input.consignmentId,
        r2Key: input.r2Key,
        contentType: input.contentType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        captureType: input.captureType,
        status: "PENDING",
        requestHash: context.requestHash,
        sortOrder: { FRONT: 0, REAR: 1, SIDE: 2, INTERIOR: 3, DASHBOARD: 4 }[input.captureType],
        version: 1,
        uploadedAt: context.occurredAt,
        updatedAt: context.occurredAt,
        createdAt: context.occurredAt,
      };
      rows.set(record.id, record);
      idempotency.set(context.idempotencyKey, { hash: context.requestHash, mediaId: record.id });
      return { ok: true, record, replayed: false };
    },
    confirmReady: async (mediaId, expectedVersion, occurredAt) => {
      const row = rows.get(mediaId);
      if (!row || (row.status !== "PENDING" && row.status !== "FAILED") || row.version !== expectedVersion) return false;
      row.status = "READY";
      row.version += 1;
      row.updatedAt = occurredAt;
      return true;
    },
    markFailed: async (mediaId, occurredAt) => {
      const row = rows.get(mediaId);
      if (row && row.status === "PENDING") {
        row.status = "FAILED";
        row.version += 1;
        row.updatedAt = occurredAt;
      }
    },
    archiveStale: async (consignmentId, cutoffIso, occurredAt) => {
      const stale = [...rows.values()].filter(
        (row) => row.consignmentId === consignmentId
          && (row.status === "PENDING" || row.status === "FAILED")
          && row.updatedAt < cutoffIso,
      );
      for (const row of stale) {
        row.status = "ARCHIVED";
        row.version += 1;
        row.updatedAt = occurredAt;
        for (const [key, value] of idempotency) {
          if (value.mediaId === row.id) idempotency.delete(key);
        }
      }
      archived = [...archived, ...stale];
      return stale;
    },
  };
  const objects = {
    async putPrivateConsignmentImage(input) {
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
    async deleteObject(key) {
      deleteCount += 1;
      const mediaId = key.split("/").pop();
      delete stored[mediaId];
    },
  };
  return {
    runtime: { repository, objects, now: AT, idGenerator: () => "media-1" },
    counts: () => ({ putCount, deleteCount, rows: [...rows.values()].filter((r) => r.status !== "ARCHIVED").length }),
    rows: () => [...rows.values()],
    archivedCount: () => archived.length,
    storedBody: () => stored["media-1"]?.body,
  };
}

test("con token válido la carga limpia metadatos, persiste privada y confirma READY", async () => {
  const backend = fakeBackend();
  const response = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", backend.runtime);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.captureType, "FRONT");
  assert.equal(payload.data.byteSize, backend.storedBody().byteLength);
  assert.equal(payload.data.sha256, await digestImageSha256(backend.storedBody()));
  const decoded = new TextDecoder().decode(backend.storedBody());
  assert.equal(decoded.includes("GPS"), false);
  assert.equal(backend.rows()[0].status, "READY");
  assert.equal(backend.counts().putCount, 1);
});

test("sin token, con token incorrecto, registro legacy o código inexistente la respuesta es indistinguible", async () => {
  const backend = fakeBackend();
  const cases = [
    ["sin authorization", uploadRequest(jpegWithGps(), { Authorization: "" })],
    ["esquema ajeno", uploadRequest(jpegWithGps(), { Authorization: "Basic abc" })],
    ["token incorrecto", uploadRequest(jpegWithGps(), { Authorization: "Bearer wrong-token-aaaaaaaaaaaaaaaaaaaaaaaaaaa" })],
  ];
  for (const [label, request] of cases) {
    const response = await publicConsignmentPhotoUpload(request, "CON-ABC123", backend.runtime);
    assert.equal(response.status, 404, label);
    const body = await response.json();
    assert.equal(body.error.code, "CONSIGNMENT_NOT_FOUND", label);
  }

  const legacy = fakeBackend({ uploadTokenHash: null });
  const legacyResponse = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", legacy.runtime);
  assert.equal(legacyResponse.status, 404);
  assert.equal((await legacyResponse.json()).error.code, "CONSIGNMENT_NOT_FOUND");

  const unknown = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ZZZ999", backend.runtime);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, "CONSIGNMENT_NOT_FOUND");

  assert.deepEqual(backend.counts(), { putCount: 0, deleteCount: 0, rows: 0 });
});

test("el replay idéntico responde 200 sin segundo objeto ni fila", async () => {
  const backend = fakeBackend();
  await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", backend.runtime);
  const replay = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", backend.runtime);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, rows: 1 });
});

test("la misma clave con otra foto conflictúa", async () => {
  const backend = fakeBackend();
  await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", backend.runtime);
  const conflict = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "X-Capture-Type": "REAR" }),
    "CON-ABC123",
    backend.runtime,
  );
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.equal(body.error.code, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(backend.counts(), { putCount: 1, deleteCount: 0, rows: 1 });
});

test("un espacio por captura y consignaciones cerradas rechazan cargas", async () => {
  const occupied = fakeBackend();
  await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", occupied.runtime);
  const second = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "Idempotency-Key": "consignment-photo-002" }),
    "CON-ABC123",
    occupied.runtime,
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "CONSIGNMENT_CAPTURE_OCCUPIED");

  const closed = fakeBackend({ status: "IN_REVIEW" });
  const response = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", closed.runtime);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CONSIGNMENT_UPLOAD_CLOSED");
});

test("código, tipo, tamaño y captura inválidos fallan cerrados", async () => {
  const backend = fakeBackend();

  const heic = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "Content-Type": "image/heic" }),
    "CON-ABC123",
    backend.runtime,
  );
  assert.equal(heic.status, 415);

  const badCapture = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "X-Capture-Type": "SIDE_LEFT" }),
    "CON-ABC123",
    backend.runtime,
  );
  assert.equal(badCapture.status, 422);

  const noKey = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "Idempotency-Key": "" }),
    "CON-ABC123",
    backend.runtime,
  );
  assert.equal(noKey.status, 400);

  const malformed = new Uint8Array([1, 2, 3, 4, 5]);
  const invalidBytes = await publicConsignmentPhotoUpload(
    uploadRequest(malformed),
    "CON-ABC123",
    backend.runtime,
  );
  assert.equal(invalidBytes.status, 422);

  assert.deepEqual(backend.counts(), { putCount: 0, deleteCount: 0, rows: 0 });
});

test("una falla de R2 deja la fila FAILED sin afirmar éxito, y el reintento la reanuda", async () => {
  let failPut = true;
  const backend = fakeBackend();
  const storedCopy = {};
  const store = {
    putPrivateConsignmentImage: async (input) => {
      if (failPut) throw new Error("R2 unavailable");
      storedCopy[input.mediaId] = input;
      return input.mediaId;
    },
    getPrivateObject: async (key) => {
      const mediaId = key.split("/").pop();
      return storedCopy[mediaId] ? { body: new Blob([storedCopy[mediaId].body]).stream() } : null;
    },
    deleteObject: async () => {},
  };
  const runtime = { ...backend.runtime, objects: store };

  const failed = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", runtime);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(backend.rows()[0].status, "FAILED");
  assert.equal(backend.rows().length, 1);

  failPut = false;
  const recovered = await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", runtime);
  assert.equal(recovered.status, 201);
  assert.equal(backend.rows()[0].status, "READY");
  assert.equal(backend.rows().length, 1);
});

test("las reservas abandonadas se archivan y liberan su objeto huérfano", async () => {
  const backend = fakeBackend();
  // Una fila PENDING vieja ocupa el slot FRONT.
  backend.runtime.repository.insertUpload(
    {
      mediaId: "media-old",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-old",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-old", requestHash: "hash-old", occurredAt: "2026-08-01T00:00:00.000Z" },
  );
  const response = await publicConsignmentPhotoUpload(
    uploadRequest(jpegWithGps(), { "Idempotency-Key": "consignment-photo-fresh" }),
    "CON-ABC123",
    { ...backend.runtime, staleMinutes: 60 },
  );
  assert.equal(response.status, 201);
  assert.equal(backend.archivedCount(), 1);
  assert.equal(backend.counts().deleteCount, 1);
  const statuses = backend.rows().map((row) => row.status).sort();
  assert.deepEqual(statuses, ["ARCHIVED", "READY"].sort());
});

test("el listado y los bytes administrativos exigen sesión y sólo entregan READY", async () => {
  const backend = fakeBackend();
  await publicConsignmentPhotoUpload(uploadRequest(), "CON-ABC123", backend.runtime);

  const anonList = await adminConsignmentPhotoList(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos"),
    "consignment-1",
    backend.runtime,
  );
  assert.equal(anonList.status, 401);

  const anonBytes = await adminConsignmentPhotoBytes(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos/media-1"),
    "consignment-1",
    "media-1",
    backend.runtime,
  );
  assert.equal(anonBytes.status, 401);

  const list = await adminConsignmentPhotoList(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos", {
      headers: adminHeaders(),
    }),
    "consignment-1",
    backend.runtime,
  );
  assert.equal(list.status, 200);
  const payload = await list.json();
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].url, "/api/v1/admin/consignments/consignment-1/photos/media-1");
  assert.equal("r2Key" in payload.data[0], false);

  const bytes = await adminConsignmentPhotoBytes(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos/media-1", {
      headers: adminHeaders(),
    }),
    "consignment-1",
    "media-1",
    backend.runtime,
  );
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers.get("Content-Type"), "image/jpeg");
  assert.equal(bytes.headers.get("Cache-Control"), "private, no-store");

  // Una fila PENDING nunca se lista ni se entrega.
  await backend.runtime.repository.insertUpload(
    {
      mediaId: "media-pending",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-pending",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "b".repeat(64),
      captureType: "REAR",
    },
    { idempotencyKey: "key-pending", requestHash: "hash-pending", occurredAt: AT.toISOString() },
  );
  const filtered = await adminConsignmentPhotoList(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos", {
      headers: adminHeaders(),
    }),
    "consignment-1",
    backend.runtime,
  );
  assert.equal((await filtered.json()).data.length, 1);

  const pendingBytes = await adminConsignmentPhotoBytes(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos/media-pending", {
      headers: adminHeaders(),
    }),
    "consignment-1",
    "media-pending",
    backend.runtime,
  );
  assert.equal(pendingBytes.status, 404);

  const missing = await adminConsignmentPhotoBytes(
    new Request("http://localhost/api/v1/admin/consignments/consignment-1/photos/nope", {
      headers: adminHeaders(),
    }),
    "consignment-1",
    "nope",
    backend.runtime,
  );
  assert.equal(missing.status, 404);
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

function consignmentDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0001_worried_valkyrie.sql",
    "drizzle/0002_seed_demo_publication.sql",
    "drizzle/0004_furry_ultimatum.sql",
    "drizzle/0008_consignment_virtual.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  database.prepare(
    `INSERT INTO consignment
     (id, public_code, idempotency_key, command_hash, upload_token_hash, make, model,
      year, mileage_km, declared_condition, status)
     VALUES ('consignment-1', 'CON-ABC123', 'seed', 'seed-command', ?, 'Toyota', 'Corolla', 2020,
             50000, 'GOOD', 'SUBMITTED')`,
  ).run(UPLOAD_TOKEN_HASH);
  return database;
}

test("el repositorio exige el lifecycle PENDING → READY | FAILED → ARCHIVED sobre SQL real", async () => {
  const repository = new D1ConsignmentMediaRepository(sqliteD1(consignmentDatabase()));

  const found = await repository.findConsignmentByPublicCode("CON-ABC123");
  assert.deepEqual(found, { id: "consignment-1", status: "SUBMITTED", uploadTokenHash: UPLOAD_TOKEN_HASH });

  const first = await repository.insertUpload(
    {
      mediaId: "media-1",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-1",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-1", requestHash: "hash-1", occurredAt: AT.toISOString() },
  );
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(first.record.status, "PENDING");
  assert.equal(first.record.sortOrder, 0);
  assert.equal(first.record.version, 1);

  // Nadie lista ni entrega una fila PENDING.
  assert.equal((await repository.listReadyByConsignment("consignment-1")).length, 0);
  assert.equal(await repository.findReadyByMediaId("consignment-1", "media-1"), null);

  assert.equal(await repository.confirmReady("media-1", 1, AT.toISOString()), true);
  // La confirmación es guardada por versión: un doble intento no avanza.
  assert.equal(await repository.confirmReady("media-1", 1, AT.toISOString()), false);
  assert.equal((await repository.listReadyByConsignment("consignment-1"))[0].status, "READY");

  const replay = await repository.insertUpload(
    {
      mediaId: "media-2",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-2",
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
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-3",
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
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-4",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "c".repeat(64),
      captureType: "REAR",
    },
    { idempotencyKey: "key-1", requestHash: "hash-other", occurredAt: AT.toISOString() },
  );
  assert.deepEqual(conflict, { ok: false, reason: "duplicate" });
});

test("el repositorio archiva reservas viejas, borra su idempotencia y libera el slot", async () => {
  const repository = new D1ConsignmentMediaRepository(sqliteD1(consignmentDatabase()));

  const stale = await repository.insertUpload(
    {
      mediaId: "media-stale",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-stale",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "a".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-stale", requestHash: "hash-stale", occurredAt: "2026-08-01T00:00:00.000Z" },
  );
  assert.equal(stale.ok, true);
  await repository.markFailed("media-stale", "2026-08-01T00:05:00.000Z");

  const archived = await repository.archiveStale(
    "consignment-1",
    "2026-08-10T00:00:00.000Z",
    AT.toISOString(),
  );
  assert.equal(archived.length, 1);
  assert.equal(archived[0].r2Key, "private/consignments/consignment-1/media-stale");

  // El slot quedó libre: una captura nueva del mismo tipo entra sin conflicto.
  const fresh = await repository.insertUpload(
    {
      mediaId: "media-fresh",
      consignmentId: "consignment-1",
      r2Key: "private/consignments/consignment-1/media-fresh",
      contentType: "image/jpeg",
      byteSize: 10,
      sha256: "d".repeat(64),
      captureType: "FRONT",
    },
    { idempotencyKey: "key-fresh", requestHash: "hash-fresh", occurredAt: AT.toISOString() },
  );
  assert.equal(fresh.ok, true);
  assert.equal(fresh.record.status, "PENDING");

  // Una reserva reciente no se archiva.
  await repository.archiveStale("consignment-1", "2026-08-01T00:00:00.000Z", AT.toISOString());
  const statuses = (await repository.findByMediaId("consignment-1", "media-fresh")).status;
  assert.equal(statuses, "PENDING");
});

test("la migración 0008 aplica incrementalmente sobre una base en 0007", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  const chain = [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0001_worried_valkyrie.sql",
    "drizzle/0002_seed_demo_publication.sql",
    "drizzle/0003_confirm_jda_whatsapp.sql",
    "drizzle/0004_furry_ultimatum.sql",
    "drizzle/0005_lucky_exiles.sql",
    "drizzle/0006_nostalgic_scarlet_spider.sql",
    "drizzle/0007_appraisal_media_capture.sql",
  ];
  for (const path of chain) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'consignment'").get(), undefined);
  database.exec(
    readFileSync("drizzle/0008_consignment_virtual.sql", "utf8").replaceAll("--> statement-breakpoint", ""),
  );
  const columns = database.prepare("PRAGMA table_info(consignment_media)").all().map((c) => c.name);
  for (const expected of ["status", "request_hash", "version", "updated_at"]) {
    assert.ok(columns.includes(expected), `falta ${expected}`);
  }
  const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'uq_consignment_media_capture'").get();
  assert.match(indexes.sql, /WHERE status <> 'ARCHIVED'/);
});
