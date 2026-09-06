// Prueba de tasación de punta a punta contra la infraestructura real: alta
// pública -> tres fotos privadas en Supabase Storage -> lectura admin (lista
// y bytes) -> revisión real SUBMITTED -> IN_REVIEW -> ESTIMATED -> APPROVED.
//
// Mismo motivo que tests/e2e-consignment-journey.test.mjs: las pruebas de
// tests/appraisal-media-api.test.mjs corren contra fixtures/node:sqlite, que
// conservan el alias de columna tal cual se escribe. Postgres no — plegaba a
// minúsculas cualquier alias sin comillas (bug corregido en el commit
// a6b4e5a; ver PUERTAS_DE_SALIDA.md, "Bug crítico de aliases SQL sin
// comillas"). Esta prueba corre contra la Supabase y el Supabase Storage
// reales para que una regresión futura de ese mismo tipo no vuelva a pasar
// inadvertida.
//
// Corre dentro de una transacción de Postgres que siempre revierte (mismo
// patrón que las otras suites e2e reales) y borra a mano, en un `finally`,
// cada objeto que escribe en Supabase Storage (no participa de la
// transacción).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import postgres from "postgres";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = Object.freeze({});", shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return {
        url: "data:text/javascript,export function notFound(){const e=new Error('NEXT_NOT_FOUND');e.digest='NEXT_NOT_FOUND';throw e}",
        shortCircuit: true,
      };
    }
    if (specifier === "next/headers") {
      return {
        url: "data:text/javascript,export async function headers(){return new Headers()}",
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(
          resolve(
            projectRoot,
            specifier === "@/db"
              ? "db/index.ts"
              : specifier === "@/lib/admin"
                ? "lib/admin/index.ts"
                : relative.endsWith(".mjs")
                  ? relative
                  : `${relative}.ts`,
          ),
        ).href,
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

const { drizzle } = await import("drizzle-orm/postgres-js");
const schema = await import("../db/schema.ts");
const { SUPABASE_POSTGRES_OPTIONS, SupabaseD1Database } = await import("../db/supabase-remote.ts");
const { createRepositories } = await import("../lib/data/repositories.ts");
const {
  publicAppraisalPhotoUpload,
  adminAppraisalPhotoList,
  adminAppraisalPhotoBytes,
} = await import("../lib/server/appraisal-media.ts");
const { D1AppraisalMediaRepository, APPRAISAL_CAPTURE_TYPES } = await import(
  "../lib/data/appraisal-media-repository.ts"
);
const { objectStore } = await import("../lib/data/storage.ts");
const { D1AdminRepository } = await import("../lib/data/admin-repositories.ts");
const { adminDependencies } = await import("../lib/server/admin-adapter.ts");
const { reviewAdminAppraisal } = await import("../lib/admin/index.ts");

const NOW = new Date("2026-09-05T19:00:00.000Z");
const ACTOR = Object.freeze({ userId: "user-e2e", email: "vendedor@jda.test", displayName: "Vendedor E2E" });
const ACCOUNT = Object.freeze({
  id: "user-e2e", email: "vendedor@jda.test", name: "Vendedor E2E", phoneNormalized: null,
  leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
  lastLoginAt: null, version: 1, createdAt: NOW.toISOString(),
});

const connectionString = process.env.SUPABASE_DB_URL;
const storageConfigured = Boolean(
  process.env.SUPABASE_STORAGE_ENDPOINT &&
    process.env.SUPABASE_STORAGE_REGION &&
    process.env.SUPABASE_STORAGE_BUCKET &&
    process.env.SUPABASE_STORAGE_ACCESS_KEY_ID &&
    process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
);
const skip = !connectionString || !storageConfigured;
if (skip) {
  console.warn(
    "SUPABASE_DB_URL o SUPABASE_STORAGE_* no están configuradas: se omite la prueba de tasación de punta a punta.",
  );
}

function suite(name, fn) {
  test(name, { skip }, fn);
}

let rootSql;
function getRootSql() {
  rootSql ??= postgres(connectionString, { ssl: "require", max: 1, ...SUPABASE_POSTGRES_OPTIONS });
  return rootSql;
}
test.after(async () => {
  if (rootSql) await rootSql.end({ timeout: 5 });
});

const ROLLBACK = Symbol("e2e-appraisal-rollback");
async function withDatabase(fn) {
  let result;
  try {
    await getRootSql().begin(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result;
}

function asD1Sql(tx) {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "begin") return target.savepoint.bind(target);
      return Reflect.get(target, prop, receiver);
    },
  });
}

function bindingFor(tx) {
  tx.options ??= getRootSql().options;
  return new SupabaseD1Database({ connectionString: "", sql: asD1Sql(tx) });
}

function concatBytes(...arrays) {
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
function ascii(value) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}
function jpegSegment(marker, data) {
  const length = data.length + 2;
  return concatBytes(Uint8Array.of(0xff, marker, length >>> 8, length & 0xff), data);
}
function jpegWithGps() {
  return concatBytes(
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, concatBytes(ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0))),
    jpegSegment(0xe1, concatBytes(ascii("Exif\0\0"), ascii("MM\x00\x2aGPS:-37.32144"))),
    jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
    Uint8Array.of(0x12, 0x34),
    Uint8Array.of(0xff, 0xd9),
  );
}

function uploadRequest({ code, captureType, idempotencyKey, bytes }) {
  return new Request(`http://localhost/api/v1/appraisals/${code}/photos`, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "Idempotency-Key": idempotencyKey,
      "X-Capture-Type": captureType,
    },
    body: bytes,
  });
}

function adminGet(url) {
  return new Request(url, { method: "GET", headers: { cookie: "session=e2e" } });
}

suite(
  "de punta a punta: alta pública, tres fotos privadas reales en Supabase Storage, lectura admin y revisión real SUBMITTED -> IN_REVIEW -> ESTIMATED -> APPROVED",
  async () => {
    const uploadedKeys = [];
    try {
      await withDatabase(async (tx) => {
        const binding = bindingFor(tx);
        const db = drizzle(tx, { schema });
        const access = createRepositories(db);

        // Alta: mismo camino que app/api/v1/appraisals/route.ts (repositorio
        // Drizzle, no la capa D1 con SQL a mano — ese no tiene el bug de
        // alias porque Drizzle mapea las columnas él mismo).
        const appraisalId = "e2e-appraisal-1";
        const code = "TAS-E2EAB1";
        const appraisal = await access.appraisals.create({
          id: appraisalId,
          publicCode: code,
          idempotencyKey: "e2e-appraisal-intake",
          leadId: null,
          make: "Toyota",
          model: "Corolla",
          trim: "XEI",
          year: 2021,
          mileageKm: 45_000,
          declaredCondition: "GOOD",
          documentationStatus: null,
          hasLien: false,
          repairNotes: null,
          status: "SUBMITTED",
          certaintyLevel: "T0",
        });
        assert.equal(appraisal.publicCode, code);
        assert.equal(appraisal.status, "SUBMITTED");

        const mediaRepository = new D1AppraisalMediaRepository(binding);
        const dataRepository = new D1AdminRepository(binding, db);
        const dependencies = { ...adminDependencies(ACTOR, dataRepository), clock: () => NOW };
        const auth = {
          allowedEmails: ACCOUNT.email,
          allowedAccountIds: ACCOUNT.id,
          readSession: async () => ACCOUNT,
        };

        const captureTypes = APPRAISAL_CAPTURE_TYPES.slice(0, 3);
        let mediaIdSeq = 0;
        for (const captureType of captureTypes) {
          const uploadResponse = await publicAppraisalPhotoUpload(
            uploadRequest({
              code,
              captureType,
              idempotencyKey: `e2e-appraisal-photo-${captureType}`,
              bytes: jpegWithGps(),
            }),
            code,
            {
              repository: mediaRepository,
              objects: objectStore,
              now: NOW,
              idGenerator: () => `e2e-appraisal-media-${mediaIdSeq++}`,
            },
          );
          assert.equal(uploadResponse.status, 201, `la captura ${captureType} debe confirmarse`);
          const uploadBody = await uploadResponse.json();
          assert.equal(uploadBody.data.captureType, captureType);
          assert.ok(uploadBody.data.id, "la carga debe devolver el id de la foto");
          uploadedKeys.push(`private/appraisals/${appraisalId}/${uploadBody.data.id}`);
        }

        // Confirma contra el bucket real que las fotos existen, son privadas
        // y que el GPS/EXIF quedó fuera del objeto publicado.
        for (const key of uploadedKeys) {
          const object = await objectStore.getPrivateObject(key);
          assert.ok(object, `el objeto ${key} debe existir en Supabase Storage`);
          const bytes = new Uint8Array(await object.arrayBuffer());
          const raw = Buffer.from(bytes).toString("latin1");
          assert.doesNotMatch(raw, /GPS:-37\.32144/, "la limpieza de metadatos debe descartar el GPS embebido");
        }

        // Lectura admin: lista y bytes, contra el repositorio real (mismo
        // findByMediaId/listByAppraisal con alias que tenía el bug).
        const listResponse = await adminAppraisalPhotoList(
          adminGet(`http://localhost/api/v1/admin/appraisals/${appraisalId}/photos`),
          appraisalId,
          { repository: mediaRepository, auth },
        );
        assert.equal(listResponse.status, 200);
        const listBody = await listResponse.json();
        assert.equal(listBody.data.length, 3);
        assert.deepEqual(
          listBody.data.map((item) => item.captureType).sort(),
          [...captureTypes].sort(),
        );

        const firstMediaId = listBody.data[0].id;
        const bytesResponse = await adminAppraisalPhotoBytes(
          adminGet(`http://localhost/api/v1/admin/appraisals/${appraisalId}/photos/${firstMediaId}`),
          appraisalId,
          firstMediaId,
          { repository: mediaRepository, objects: objectStore, auth },
        );
        assert.equal(bytesResponse.status, 200);
        const deliveredBytes = new Uint8Array(await bytesResponse.arrayBuffer());
        assert.ok(deliveredBytes.byteLength > 0, "la ruta admin debe entregar bytes reales del bucket");

        // Revisión real: SUBMITTED -> IN_REVIEW -> ESTIMATED -> APPROVED.
        const inReview = await reviewAdminAppraisal(dependencies, {
          id: appraisalId,
          expectedVersion: 1,
          nextStatus: "IN_REVIEW",
        });
        assert.equal(inReview.status, "IN_REVIEW");

        const estimated = await reviewAdminAppraisal(dependencies, {
          id: appraisalId,
          expectedVersion: inReview.version,
          nextStatus: "ESTIMATED",
          lowCents: 800_000_000,
          baseCents: 900_000_000,
          highCents: 1_000_000_000,
          currency: "ARS",
          certaintyLevel: "T1",
          validUntil: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
        });
        assert.equal(estimated.status, "ESTIMATED");
        assert.equal(estimated.baseCents, 900_000_000);

        const approved = await reviewAdminAppraisal(dependencies, {
          id: appraisalId,
          expectedVersion: estimated.version,
          nextStatus: "APPROVED",
          notes: "Tasación aprobada de punta a punta (prueba e2e).",
        });
        assert.equal(approved.status, "APPROVED");

        // Cerrada, no admite más fotos.
        const lateUpload = await publicAppraisalPhotoUpload(
          uploadRequest({
            code,
            captureType: captureTypes[0],
            idempotencyKey: "e2e-appraisal-photo-late",
            bytes: jpegWithGps(),
          }),
          code,
          { repository: mediaRepository, objects: objectStore, now: NOW },
        );
        assert.equal(lateUpload.status, 409);
      });
    } finally {
      for (const key of uploadedKeys) {
        try {
          await objectStore.deleteObject(key);
        } catch (error) {
          console.error("e2e_appraisal_cleanup_failed", { key, error: String(error) });
        }
      }
    }
  },
);
