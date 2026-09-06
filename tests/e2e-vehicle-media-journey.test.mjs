// Prueba de fotos de stock de punta a punta contra la infraestructura real:
// carga admin de dos fotos reales en Supabase Storage -> lectura pública
// (publicVehicleMedia, la ruta que sirve el catálogo real) -> set_primary ->
// archive -> la foto archivada deja de servirse.
//
// Mismo motivo que las otras suites tests/e2e-*-journey.test.mjs: esta ruta
// pública (`D1VehicleMediaRepository.findPublic()`) es justamente la que
// tenía el bug de alias sin comillas corregido en el commit a6b4e5a (ver
// PUERTAS_DE_SALIDA.md) — antes del fix, las fotos reales publicadas el 5 de
// septiembre estaban bien guardadas en Supabase Storage pero esta ruta no
// podía resolver su clave real. Corre contra la Supabase y el Supabase
// Storage reales para que una regresión de ese tipo no vuelva a pasar
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

const { SUPABASE_POSTGRES_OPTIONS, SupabaseD1Database } = await import("../db/supabase-remote.ts");
const {
  adminVehicleMediaCollection,
  adminVehicleMediaItem,
  publicVehicleMedia,
} = await import("../lib/server/vehicle-media.ts");
const { D1VehicleMediaRepository } = await import("../lib/data/vehicle-media-repository.ts");
const { objectStore } = await import("../lib/data/storage.ts");

const NOW = new Date("2026-09-05T20:00:00.000Z");
const ACCOUNT = Object.freeze({
  id: "user-e2e", email: "vendedor@jda.test", name: "Vendedor E2E", phoneNormalized: null,
  leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
  lastLoginAt: null, version: 1, createdAt: NOW.toISOString(),
});
const AUTH = Object.freeze({
  allowedEmails: ACCOUNT.email,
  allowedAccountIds: ACCOUNT.id,
  readSession: async () => ACCOUNT,
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
    "SUPABASE_DB_URL o SUPABASE_STORAGE_* no están configuradas: se omite la prueba de fotos de stock de punta a punta.",
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

const ROLLBACK = Symbol("e2e-vehicle-media-rollback");
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
// Sin chunk EXIF/GPS acá: la política de stock (a diferencia de tasación y
// consignación) exige que la imagen ya llegue sin metadatos sensibles: ver
// lib/media/index.mjs inspectStockImage. `marker` varía el último byte del
// scan para que cada foto tenga su propio sha256 — el repositorio rechaza
// dos fotos idénticas para el mismo vehículo.
function jpegPlain(marker = 0x00) {
  return concatBytes(
    Uint8Array.of(0xff, 0xd8),
    jpegSegment(0xe0, concatBytes(ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0))),
    jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)),
    jpegSegment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)),
    Uint8Array.of(0x12, marker),
    Uint8Array.of(0xff, 0xd9),
  );
}

function uploadRequest({ vehicleId, version, idempotencyKey, altText, bytes }) {
  return new Request(`http://localhost/api/v1/admin/vehicles/${vehicleId}/media`, {
    method: "POST",
    headers: {
      cookie: "session=e2e",
      "Content-Type": "image/jpeg",
      "Idempotency-Key": idempotencyKey,
      "X-Vehicle-Version": String(version),
      "X-Alt-Text": altText,
    },
    body: bytes,
  });
}

function patchRequest({ vehicleId, version, body }) {
  return new Request(`http://localhost/api/v1/admin/vehicles/${vehicleId}/media`, {
    method: "PATCH",
    headers: {
      cookie: "session=e2e",
      "Content-Type": "application/json",
      "X-Vehicle-Version": String(version),
    },
    body: JSON.stringify(body),
  });
}

suite(
  "de punta a punta: dos fotos reales de stock en Supabase Storage, servidas por la ruta pública, marcadas como principal y archivadas",
  async () => {
    const uploadedKeys = [];
    try {
      await withDatabase(async (tx) => {
        const binding = bindingFor(tx);
        const vehicleId = "e2e-vehicle-1";

        await tx`
          INSERT INTO vehicle (
            id, slug, make, model, trim, year, mileage_km, price_cents, currency,
            body_type, fuel_type, transmission, color, status, source, version,
            created_at, updated_at
          ) VALUES (
            ${vehicleId}, 'e2e-vehicle-1', 'Fiat', 'Cronos', 'Drive', 2022, 30000,
            2590000000, 'ARS', 'auto', 'Nafta', 'Manual', 'Blanco', 'AVAILABLE',
            'manual', 1, ${NOW.toISOString()}, ${NOW.toISOString()}
          )
        `;

        const repository = new D1VehicleMediaRepository(binding);
        let vehicleVersion = 1;
        const mediaIds = [];
        let mediaIdSeq = 0;

        for (const [index, label] of ["frente", "lateral"].entries()) {
          const uploadResponse = await adminVehicleMediaCollection(
            uploadRequest({
              vehicleId,
              version: vehicleVersion,
              idempotencyKey: `e2e-vehicle-photo-${label}`,
              altText: `Fiat Cronos 2022, foto de ${label}`,
              bytes: jpegPlain(index),
            }),
            vehicleId,
            { auth: AUTH, repository, objects: objectStore, now: NOW, idGenerator: () => `e2e-vehicle-media-${mediaIdSeq++}` },
          );
          assert.equal(uploadResponse.status, 201, `la foto ${label} debe confirmarse READY`);
          vehicleVersion = Number(uploadResponse.headers.get("X-Vehicle-Version"));
          const uploadBody = await uploadResponse.json();
          assert.ok(uploadBody.data.id, "la carga debe devolver el id de la foto");
          mediaIds.push(uploadBody.data.id);
          uploadedKeys.push(`public/stock/${vehicleId}/${uploadBody.data.id}`);
        }
        assert.equal(mediaIds.length, 2);

        // Confirma contra el bucket real que los bytes están ahí.
        for (const key of uploadedKeys) {
          const object = await objectStore.getStockObject(key);
          assert.ok(object, `el objeto ${key} debe existir en Supabase Storage`);
        }

        // La ruta pública real (la que tenía el bug de alias) debe poder
        // servir la primera foto con sus bytes reales.
        const publicResponse = await publicVehicleMedia(
          new Request(`http://localhost/api/v1/media/vehicles/${mediaIds[0]}`),
          mediaIds[0],
          { repository, objects: objectStore },
        );
        assert.equal(publicResponse.status, 200);
        const deliveredBytes = new Uint8Array(await publicResponse.arrayBuffer());
        assert.ok(deliveredBytes.byteLength > 0, "la ruta pública debe entregar bytes reales del bucket");
        const etag = publicResponse.headers.get("ETag");
        assert.ok(etag, "la respuesta pública debe traer ETag");

        // Condicional: mismo ETag responde 304 sin volver a leer el bucket.
        const conditional = await publicVehicleMedia(
          new Request(`http://localhost/api/v1/media/vehicles/${mediaIds[0]}`, {
            headers: { "If-None-Match": etag },
          }),
          mediaIds[0],
          { repository, objects: objectStore },
        );
        assert.equal(conditional.status, 304);

        // set_primary: la segunda foto pasa a ser la primera de la lista.
        const setPrimaryResponse = await adminVehicleMediaItem(
          patchRequest({ vehicleId, version: vehicleVersion, body: { action: "set_primary" } }),
          vehicleId,
          mediaIds[1],
          { auth: AUTH, repository, now: NOW },
        );
        assert.equal(setPrimaryResponse.status, 200);
        vehicleVersion = Number(setPrimaryResponse.headers.get("X-Vehicle-Version"));
        const reordered = await setPrimaryResponse.json();
        assert.equal(reordered.data[0].id, mediaIds[1]);

        // Archive: la foto archivada deja de servirse por la ruta pública.
        const archiveResponse = await adminVehicleMediaItem(
          patchRequest({ vehicleId, version: vehicleVersion, body: { action: "archive" } }),
          vehicleId,
          mediaIds[0],
          { auth: AUTH, repository, now: NOW },
        );
        assert.equal(archiveResponse.status, 200);
        vehicleVersion = Number(archiveResponse.headers.get("X-Vehicle-Version"));

        const afterArchive = await publicVehicleMedia(
          new Request(`http://localhost/api/v1/media/vehicles/${mediaIds[0]}`),
          mediaIds[0],
          { repository, objects: objectStore },
        );
        assert.equal(afterArchive.status, 404);
      });
    } finally {
      for (const key of uploadedKeys) {
        try {
          await objectStore.deleteObject(key);
        } catch (error) {
          console.error("e2e_vehicle_media_cleanup_failed", { key, error: String(error) });
        }
      }
    }
  },
);
