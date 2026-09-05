// Prueba de consignación virtual de punta a punta contra la infraestructura
// real: alta -> token de carga -> cinco fotos privadas en Supabase Storage ->
// intento de revisión sin las cinco listo -> revisión real -> decisión.
//
// Cierra el criterio 9 de GOAL_JDA_CANDIDATA_PRODUCCION.md ("El recorrido
// completo fue probado en UI, API, Supabase y R2 [hoy Supabase Storage] con
// evidencia"): las pruebas de tests/consignment-*.test.mjs cubren el mismo
// recorrido contra fixtures/D1 en memoria, no contra Postgres real ni el
// bucket real.
//
// Cada prueba corre dentro de su propia transacción de Postgres que nunca se
// confirma (igual que tests/e2e-commercial-journey.test.mjs): termina siempre
// en ROLLBACK, así que la base real de Supabase queda intacta. Supabase
// Storage no es transaccional: cada objeto que la corrida escribe se borra
// explícitamente en un `finally`, pase lo que pase adentro del test.
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
const { createConsignmentIntake } = await import("../lib/server/consignment-intake.ts");
const { D1ConsignmentIntakeRepository } = await import("../lib/data/consignment-intake-repository.ts");
const { publicConsignmentPhotoUpload } = await import("../lib/server/consignment-media.ts");
const { D1ConsignmentMediaRepository, CONSIGNMENT_CAPTURE_TYPES } = await import(
  "../lib/data/consignment-media-repository.ts"
);
const { objectStore } = await import("../lib/data/storage.ts");
const { D1AdminRepository } = await import("../lib/data/admin-repositories.ts");
const { adminDependencies } = await import("../lib/server/admin-adapter.ts");
const { reviewAdminConsignment } = await import("../lib/admin/index.ts");

const NOW = new Date("2026-09-05T18:00:00.000Z");
const ACTOR = Object.freeze({ userId: "user-e2e", email: "vendedor@jda.test", displayName: "Vendedor E2E" });

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
    "SUPABASE_DB_URL o SUPABASE_STORAGE_* no están configuradas: se omite la prueba de consignación de punta a punta.",
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

// Igual que tests/e2e-commercial-journey.test.mjs: revierte siempre, con o
// sin error adentro.
const ROLLBACK = Symbol("e2e-consignment-rollback");
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

// Bytes suficientes para que sharp/el inspector de imágenes lo acepte como un
// JPEG válido con un chunk EXIF/GPS real que la limpieza de metadatos debe
// descartar; mismo layout que usan tests/consignment-media-api.test.mjs y
// tests/appraisal-media-api.test.mjs.
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

function intakeRequest(idempotencyKey) {
  return new Request("http://localhost/api/v1/consignments", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      contactConsent: true,
      name: "Dueño E2E",
      phone: "2494587046",
      vehicle: {
        make: "Fiat",
        model: "Cronos",
        year: 2022,
        mileageKm: 30_000,
        declaredCondition: "GOOD",
      },
    }),
  });
}

function uploadRequest({ code, token, captureType, idempotencyKey, bytes }) {
  return new Request(`http://localhost/api/v1/consignments/${code}/photos`, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "Idempotency-Key": idempotencyKey,
      "X-Capture-Type": captureType,
      Authorization: `Bearer ${token}`,
    },
    body: bytes,
  });
}

suite(
  "de punta a punta: alta, cinco fotos privadas reales en Supabase Storage, el servidor exige las cinco antes de revisar, y la decisión real cierra la consignación",
  async () => {
    const uploadedKeys = [];
    try {
      await withDatabase(async (tx) => {
        const binding = bindingFor(tx);
        const db = drizzle(tx, { schema });

        // Alta: lead + consentimiento + consignación en un único batch atómico,
        // con el token de carga entregado una sola vez.
        const intakeResponse = await createConsignmentIntake(
          intakeRequest("e2e-consignment-intake"),
          {
            repository: new D1ConsignmentIntakeRepository(binding),
            now: NOW,
            idGenerator: () => "e2e-consignment-1",
            codeGenerator: () => "CON-E2EAB1",
          },
        );
        assert.equal(intakeResponse.status, 201);
        const intakeBody = await intakeResponse.json();
        const code = intakeBody.data.code;
        const token = intakeBody.data.uploadToken;
        assert.equal(code, "CON-E2EAB1");
        assert.ok(token && token.length >= 32, "el alta debe entregar el token de carga una sola vez");

        const [{ id: consignmentId, version: initialVersion }] = await tx`
          SELECT id, version FROM consignment WHERE public_code = ${code}
        `;
        assert.equal(initialVersion, 1);

        const mediaRepository = new D1ConsignmentMediaRepository(binding);
        const dataRepository = new D1AdminRepository(binding, db);
        // Mismo factory que usa producción (lib/server/admin-adapter.ts), no
        // una versión simplificada: la prueba debe ejercitar el camino real.
        const dependencies = { ...adminDependencies(ACTOR, dataRepository), clock: () => NOW };

        // Sin las cinco fotos READY, el servidor rechaza pasar a revisión —
        // el mismo invariante que las pruebas con fixtures, ahora contra la
        // Supabase y el Supabase Storage reales.
        await assert.rejects(
          () =>
            reviewAdminConsignment(dependencies, {
              id: consignmentId,
              expectedVersion: initialVersion,
              nextStatus: "IN_REVIEW",
            }),
          (error) => error.code === "ADMIN_INVALID_TRANSITION",
        );

        // Sube las cinco capturas reales: cada una pasa por el inspector de
        // imágenes, la limpieza de metadatos y el PUT real a Supabase Storage.
        let mediaIdSeq = 0;
        for (const captureType of CONSIGNMENT_CAPTURE_TYPES) {
          const uploadResponse = await publicConsignmentPhotoUpload(
            uploadRequest({
              code,
              token,
              captureType,
              idempotencyKey: `e2e-consignment-photo-${captureType}`,
              bytes: jpegWithGps(),
            }),
            code,
            {
              repository: mediaRepository,
              objects: objectStore,
              now: NOW,
              idGenerator: () => `e2e-consignment-media-${mediaIdSeq++}`,
            },
          );
          // 201 sólo lo devuelve driveStorageToReady() tras confirmar READY
          // (ver lib/server/consignment-media.ts); la respuesta pública no
          // repite el status.
          assert.equal(uploadResponse.status, 201, `la captura ${captureType} debe confirmarse READY`);
          const uploadBody = await uploadResponse.json();
          assert.equal(uploadBody.data.captureType, captureType);
          assert.ok(uploadBody.data.id, "la carga debe devolver el id de la foto");
          uploadedKeys.push(`private/consignments/${consignmentId}/${uploadBody.data.id}`);
        }

        // Confirma contra el bucket real que las fotos existen, son privadas
        // (no hay URL pública) y que la GPS/EXIF quedó fuera del objeto
        // publicado.
        for (const key of uploadedKeys) {
          const object = await objectStore.getPrivateObject(key);
          assert.ok(object, `el objeto ${key} debe existir en Supabase Storage`);
          const bytes = new Uint8Array(await object.arrayBuffer());
          const raw = Buffer.from(bytes).toString("latin1");
          assert.doesNotMatch(raw, /GPS:-37\.32144/, "la limpieza de metadatos debe descartar el GPS embebido");
        }

        const readyCount = await dataRepository.countReadyConsignmentMedia(consignmentId);
        assert.equal(readyCount, 5);

        // Ahora sí: exactamente cinco fotos READY habilitan la revisión real.
        const inReview = await reviewAdminConsignment(dependencies, {
          id: consignmentId,
          expectedVersion: initialVersion,
          nextStatus: "IN_REVIEW",
        });
        assert.equal(inReview.status, "IN_REVIEW");

        const accepted = await reviewAdminConsignment(dependencies, {
          id: consignmentId,
          expectedVersion: inReview.version,
          nextStatus: "ACCEPTED",
          notes: "Unidad revisada de punta a punta (prueba e2e).",
        });
        assert.equal(accepted.status, "ACCEPTED");

        // Cerrado el caso no admite más fotos ni una segunda decisión.
        const rejectedUpload = await publicConsignmentPhotoUpload(
          uploadRequest({
            code,
            token,
            captureType: "FRONT",
            idempotencyKey: "e2e-consignment-photo-late",
            bytes: jpegWithGps(),
          }),
          code,
          { repository: mediaRepository, objects: objectStore, now: NOW },
        );
        assert.equal(rejectedUpload.status, 409);
      });
    } finally {
      // Supabase Storage no participa de la transacción revertida: hay que
      // borrar a mano cada objeto que esta corrida escribió, pase lo que pase.
      for (const key of uploadedKeys) {
        try {
          await objectStore.deleteObject(key);
        } catch (error) {
          console.error("e2e_consignment_cleanup_failed", { key, error: String(error) });
        }
      }
    }
  },
);
