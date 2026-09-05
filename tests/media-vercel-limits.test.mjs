import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      return {
        url: pathToFileURL(resolve(
          projectRoot,
          relative.endsWith(".mjs") ? relative : `${relative}.ts`,
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

const { MAX_MEDIA_IMAGE_BYTES, inspectStockImage } = await import("../lib/media/index.mjs");
const { RemoteR2ObjectStore } = await import("../lib/data/r2-remote.ts");
const { publicVehicleMedia } = await import("../lib/server/vehicle-media.ts");
const { adminAppraisalPhotoBytes } = await import("../lib/server/appraisal-media.ts");
const { adminConsignmentPhotoBytes } = await import("../lib/server/consignment-media.ts");

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function jpeg(scanByteSize) {
  const frame = Uint8Array.of(
    0xff, 0xc0, 0x00, 0x0b,
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  );
  const scan = Uint8Array.of(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  return concat(Uint8Array.of(0xff, 0xd8), frame, scan, new Uint8Array(scanByteSize), Uint8Array.of(0xff, 0xd9));
}

function adminAuth() {
  return {
    allowedEmails: "admin@example.com",
    allowedAccountIds: "user-1",
    async readSession() {
      return {
        id: "user-1", email: "admin@example.com", name: "Operador", phoneNormalized: null,
        leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null,
        lastLoginAt: null, version: 1, createdAt: "2026-09-04T12:00:00.000Z",
      };
    },
  };
}

test("the shared policy accepts exactly 4 MiB and rejects the following byte", async () => {
  const baseSize = jpeg(0).byteLength;
  const exact = jpeg(MAX_MEDIA_IMAGE_BYTES - baseSize);
  assert.equal(exact.byteLength, MAX_MEDIA_IMAGE_BYTES);
  const result = await inspectStockImage({ bytes: exact, declaredContentType: "image/jpeg" });
  assert.equal(result.byteSize, MAX_MEDIA_IMAGE_BYTES);
  await assert.rejects(
    () => inspectStockImage({ bytes: jpeg(MAX_MEDIA_IMAGE_BYTES + 1 - baseSize), declaredContentType: "image/jpeg" }),
    (error) => error.code === "STOCK_IMAGE_TOO_LARGE",
  );
});

test("R2 adapters reject an over-limit declaration before sending bytes", async () => {
  const commands = [];
  const store = new RemoteR2ObjectStore({
    endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    bucket: "jda-uploads",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    client: { send: async (command) => { commands.push(command); } },
  });
  const input = { body: new ArrayBuffer(1), contentType: "image/jpeg", byteSize: MAX_MEDIA_IMAGE_BYTES + 1, sha256: "a".repeat(64) };
  await assert.rejects(() => store.putStockImage({ ...input, vehicleId: "vehicle-1", mediaId: "media-1" }), /STOCK_IMAGE_SIZE_OUT_OF_RANGE/);
  await assert.rejects(() => store.putPrivateAppraisalImage({ ...input, appraisalId: "appraisal-1", mediaId: "media-2" }), /APPRAISAL_IMAGE_SIZE_OUT_OF_RANGE/);
  await assert.rejects(() => store.putPrivateConsignmentImage({ ...input, consignmentId: "consignment-1", mediaId: "media-3" }), /CONSIGNMENT_IMAGE_SIZE_OUT_OF_RANGE/);
  assert.equal(commands.length, 0);
});

test("legacy over-limit metadata is rejected before any R2 read", async () => {
  let reads = 0;
  const objects = { getStockObject: async () => { reads += 1; return null; }, getPrivateObject: async () => { reads += 1; return null; } };
  const vehicle = await publicVehicleMedia(
    new Request("http://localhost/api/v1/media/vehicles/media-1"),
    "media-1",
    {
      repository: { findPublic: async () => ({ id: "media-1", byteSize: MAX_MEDIA_IMAGE_BYTES + 1, sha256: "a".repeat(64), contentType: "image/jpeg", r2Key: "public/stock/v/media-1" }) },
      objects,
    },
  );
  assert.equal(vehicle.status, 413);
  assert.equal((await vehicle.json()).error.code, "STOCK_IMAGE_TOO_LARGE");

  const appraisal = await adminAppraisalPhotoBytes(
    new Request("http://localhost/api/v1/admin/appraisals/a/photos/m"),
    "appraisal-1",
    "media-1",
    {
      auth: adminAuth(),
      repository: { findByMediaId: async () => ({ appraisalId: "appraisal-1", id: "media-1", byteSize: MAX_MEDIA_IMAGE_BYTES + 1, sha256: "b".repeat(64), contentType: "image/jpeg", r2Key: "private/appraisals/a/m" }) },
      objects,
    },
  );
  assert.equal(appraisal.status, 413);
  assert.equal((await appraisal.json()).error.code, "APPRAISAL_IMAGE_TOO_LARGE");

  const consignment = await adminConsignmentPhotoBytes(
    new Request("http://localhost/api/v1/admin/consignments/c/photos/m"),
    "consignment-1",
    "media-1",
    {
      auth: adminAuth(),
      repository: { findReadyByMediaId: async () => ({ consignmentId: "consignment-1", id: "media-1", byteSize: MAX_MEDIA_IMAGE_BYTES + 1, sha256: "c".repeat(64), contentType: "image/jpeg", r2Key: "private/consignments/c/m" }) },
      objects,
    },
  );
  assert.equal(consignment.status, 413);
  assert.equal((await consignment.json()).error.code, "CONSIGNMENT_IMAGE_TOO_LARGE");
  assert.equal(reads, 0);
});
