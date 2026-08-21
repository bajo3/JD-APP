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

const { createConsignmentIntake } = await import("../lib/server/consignment-intake.ts");
const { D1ConsignmentIntakeRepository } =
  await import("../lib/data/consignment-intake-repository.ts");
const { D1ConsignmentMediaRepository } = await import("../lib/data/consignment-media-repository.ts");
const { publicConsignmentPhotoUpload } = await import("../lib/server/consignment-media.ts");
const { digestImageSha256 } = await import("../lib/media/index.mjs");

const AT = new Date("2026-08-19T12:00:00.000Z");

function intakeRequest(payload, headers = {}) {
  return new Request("http://localhost/api/v1/consignments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "intake-key-001",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function validPayload(overrides = {}) {
  return {
    name: "Martín González",
    phone: "2494587046",
    contactConsent: true,
    vehicle: {
      make: "Toyota",
      model: "Corolla XEI",
      year: 2022,
      mileageKm: 48000,
      declaredCondition: "GOOD",
    },
    ...overrides,
  };
}

test("el alta crea lead, consentimiento y consignación y entrega el token una sola vez", async () => {
  const created = [];
  const repository = {
    create: async (input) => {
      created.push(input);
      return {
        ok: true,
        replayed: false,
        record: {
          id: input.consignmentId,
          publicCode: input.publicCode,
          leadId: input.leadId,
          commandHash: input.commandHash,
          status: "SUBMITTED",
          createdAt: AT.toISOString(),
        },
      };
    },
  };
  const response = await createConsignmentIntake(intakeRequest(validPayload()), {
    repository,
    now: AT,
    idGenerator: () => "lead-1",
    codeGenerator: () => "CON-ABC123",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.code, "CON-ABC123");
  assert.equal(body.meta.idempotencyReplayed, false);
  // Token bearer de al menos 256 bits, base64url.
  assert.match(body.data.uploadToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await digestImageSha256(new TextEncoder().encode(body.data.uploadToken))), created[0].uploadTokenHash);

  assert.equal(created.length, 1);
  assert.equal(created[0].owner.source, "CONSIGNACION_WEB");
  assert.equal(created[0].consent.purpose, "CONTACT_REQUEST");
  assert.equal(created[0].vehicle.make, "Toyota");
});

test("el replay reproduce el alta sin volver a entregar el token", async () => {
  let calls = 0;
  const repository = {
    create: async (input) => {
      calls += 1;
      return {
        ok: true,
        replayed: true,
        record: {
          id: input.consignmentId,
          publicCode: "CON-ABC123",
          leadId: input.leadId,
          commandHash: input.commandHash,
          status: "SUBMITTED",
          createdAt: AT.toISOString(),
        },
      };
    },
  };
  const response = await createConsignmentIntake(intakeRequest(validPayload()), {
    repository,
    now: AT,
    idGenerator: () => "lead-1",
    codeGenerator: () => "CON-ABC123",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Idempotency-Replayed"), "true");
  const body = await response.json();
  assert.equal("uploadToken" in body.data, false);
  assert.equal(body.meta.idempotencyReplayed, true);
  assert.equal(calls, 1);
});

test("la misma clave con otro comando responde 409 sin escrituras", async () => {
  const repository = {
    create: async () => ({ ok: false, reason: "idempotency_conflict" }),
  };
  const response = await createConsignmentIntake(
    intakeRequest(validPayload({ vehicle: { ...validPayload().vehicle, make: "Honda" } })),
    { repository, now: AT },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
});

test("sin consentimiento o con datos inválidos el alta falla antes de escribir", async () => {
  const repository = { create: async () => { throw new Error("no debe escribir"); } };

  const noConsent = await createConsignmentIntake(
    intakeRequest(validPayload({ contactConsent: false })),
    { repository, now: AT },
  );
  assert.equal(noConsent.status, 422);
  assert.equal((await noConsent.json()).error.code, "CONTACT_CONSENT_REQUIRED");

  const badPhone = await createConsignmentIntake(
    intakeRequest(validPayload({ phone: "123" })),
    { repository, now: AT },
  );
  assert.equal(badPhone.status, 422);

  const badVehicle = await createConsignmentIntake(
    intakeRequest(validPayload({ vehicle: { make: "Toyota" } })),
    { repository, now: AT },
  );
  assert.equal(badVehicle.status, 422);

  const badCondition = await createConsignmentIntake(
    intakeRequest(validPayload({ vehicle: { ...validPayload().vehicle, declaredCondition: "NEW" } })),
    { repository, now: AT },
  );
  assert.equal(badCondition.status, 422);

  const noKey = await createConsignmentIntake(
    new Request("http://localhost/api/v1/consignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload()),
    }),
    { repository, now: AT },
  );
  assert.equal(noKey.status, 400);
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

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON;");
  for (const path of [
    "drizzle/0000_chemical_tiger_shark.sql",
    "drizzle/0001_worried_valkyrie.sql",
    "drizzle/0002_seed_demo_publication.sql",
    "drizzle/0004_furry_ultimatum.sql",
    "drizzle/0005_lucky_exiles.sql",
    "drizzle/0006_nostalgic_scarlet_spider.sql",
    "drizzle/0008_consignment_virtual.sql",
  ]) {
    database.exec(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

const INTAKE_INPUT = {
  consignmentId: "consignment-1",
  leadId: "lead-1",
  consentId: "consent-1",
  publicCode: "CON-ABC123",
  idempotencyKey: "intake-key-001",
  commandHash: "command-hash-1",
  uploadTokenHash: "token-hash-1",
  owner: { name: "Martín González", phoneNormalized: "2494587046", email: null, source: "CONSIGNACION_WEB" },
  vehicle: {
    make: "Toyota",
    model: "Corolla XEI",
    trim: null,
    year: 2022,
    mileageKm: 48000,
    declaredCondition: "GOOD",
    askingPriceCents: null,
    ownerNotes: null,
  },
  consent: {
    channel: "WHATSAPP_OR_PHONE",
    purpose: "CONTACT_REQUEST",
    evidenceJson: '{"method":"api_v1_consignment_intake"}',
  },
  occurredAt: AT.toISOString(),
};

test("sobre SQL real el alta escribe lead, consentimiento y consignación en un batch", async () => {
  const database = migratedDatabase();
  const repository = new D1ConsignmentIntakeRepository(sqliteD1(database));

  const result = await repository.create(INTAKE_INPUT);
  assert.equal(result.ok, true);
  assert.equal(result.replayed, false);
  assert.equal(result.record.publicCode, "CON-ABC123");

  const lead = database.prepare("SELECT * FROM lead WHERE id = 'lead-1'").get();
  assert.equal(lead.idempotency_key, "intake-key-001");
  assert.equal(lead.create_request_hash, "command-hash-1");
  assert.equal(lead.source, "CONSIGNACION_WEB");

  const consent = database.prepare("SELECT * FROM consent WHERE lead_id = 'lead-1'").get();
  assert.equal(consent.purpose, "CONTACT_REQUEST");

  const consignment = database.prepare("SELECT * FROM consignment WHERE id = 'consignment-1'").get();
  assert.equal(consignment.lead_id, "lead-1");
  assert.equal(consignment.upload_token_hash, "token-hash-1");
  assert.equal(consignment.command_hash, "command-hash-1");
  assert.equal(consignment.status, "SUBMITTED");

  // Replay: misma clave y mismo comando no duplican nada.
  const replay = await repository.create(INTAKE_INPUT);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM lead").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM consignment").get().n, 1);

  // Misma clave con otro comando: 409 lógico sin escrituras.
  const conflict = await repository.create({ ...INTAKE_INPUT, commandHash: "command-hash-2" });
  assert.deepEqual(conflict, { ok: false, reason: "idempotency_conflict" });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM consignment").get().n, 1);

  // Una clave ya usada por un lead de otro circuito tampoco escribe.
  database.prepare(
    `INSERT INTO lead (id, idempotency_key, create_request_hash, name, phone_normalized, source,
     status, score, version, created_at, updated_at)
     VALUES ('lead-2', 'intake-key-002', 'lead-command', 'Otro', '2494587046', 'CONTACTO_WEB',
     'NEW', 0, 1, ?, ?)`,
  ).run(AT.toISOString(), AT.toISOString());
  const crossConflict = await repository.create({
    ...INTAKE_INPUT,
    idempotencyKey: "intake-key-002",
    consignmentId: "consignment-2",
    leadId: "lead-3",
  });
  assert.deepEqual(crossConflict, { ok: false, reason: "idempotency_conflict" });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM consignment").get().n, 1);
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

function jpegBytes() {
  const ascii = (value) => Uint8Array.from([...value].map((c) => c.charCodeAt(0)));
  const segment = (marker, data) =>
    concat(Uint8Array.of(0xff, marker, (data.length + 2) >>> 8, (data.length + 2) & 0xff), data);
  return concat(
    Uint8Array.of(0xff, 0xd8),
    segment(0xe0, concat(ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0))),
    segment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)),
    segment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
    Uint8Array.of(0x12, 0x34),
    Uint8Array.of(0xff, 0xd9),
  );
}

test("de punta a punta: el token del alta autoriza la carga y sin él no hay bytes", async () => {
  const database = migratedDatabase();
  const d1 = sqliteD1(database);
  const intake = new D1ConsignmentIntakeRepository(d1);
  const media = new D1ConsignmentMediaRepository(d1);
  const stored = {};
  const objects = {
    async putPrivateConsignmentImage(input) {
      stored[input.mediaId] = input;
      return input.mediaId;
    },
    async getPrivateObject(key) {
      const mediaId = key.split("/").pop();
      return stored[mediaId] ? { body: new Blob([stored[mediaId].body]).stream() } : null;
    },
    async deleteObject() {},
  };

  const response = await createConsignmentIntake(intakeRequest(validPayload()), {
    repository: intake,
    now: AT,
    idGenerator: () => "lead-1",
    codeGenerator: () => "CON-ABC123",
  });
  assert.equal(response.status, 201);
  const { code, uploadToken } = (await response.json()).data;
  assert.equal(code, "CON-ABC123");

  const uploadWith = (headers) =>
    publicConsignmentPhotoUpload(
      new Request(`http://localhost/api/v1/consignments/${code}/photos`, {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "Idempotency-Key": "photo-key-1",
          "X-Capture-Type": "FRONT",
          ...headers,
        },
        body: jpegBytes(),
      }),
      code,
      { repository: media, objects, now: AT },
    );

  const denied = await uploadWith({});
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).error.code, "CONSIGNMENT_NOT_FOUND");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM consignment_media").get().n, 0);

  const uploaded = await uploadWith({ Authorization: `Bearer ${uploadToken}` });
  assert.equal(uploaded.status, 201);
  const rows = database.prepare("SELECT status FROM consignment_media").all();
  assert.deepEqual(rows.map((row) => row.status), ["READY"]);
});
