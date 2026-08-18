import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

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

const { stripImageMetadata, inspectStockImage, inspectAppraisalImage, digestImageSha256 } =
  await import("../lib/media/index.mjs");

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

function u32le(value) {
  return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24);
}

function jpegSegment(marker, data) {
  const length = data.length + 2;
  return concat(Uint8Array.of(0xff, marker, length >>> 8, length & 0xff), data);
}

function validJpeg({ exif = true, comment = true, jfifApp0 = true } = {}) {
  const segments = [];
  if (jfifApp0) {
    segments.push(jpegSegment(0xe0, concat(ascii("JFIF\0"), Uint8Array.of(1, 2, 0, 0, 1, 0, 1, 0, 0))));
  } else {
    segments.push(jpegSegment(0xe0, ascii("FAKE-APP0-HEAD")));
  }
  if (exif) {
    segments.push(jpegSegment(0xe1, concat(ascii("Exif\0\0"), ascii("MM\x00\x2aGPS:37.1234"))));
  }
  if (comment) {
    segments.push(jpegSegment(0xfe, ascii("Comentario con datos personales")));
  }
  segments.push(jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 1, 1, 1, 0x11, 0)));
  segments.push(jpegSegment(0xda, Uint8Array.of(1, 1, 0x00, 0, 63, 0)));
  return concat(
    Uint8Array.of(0xff, 0xd8),
    ...segments,
    Uint8Array.of(0x12, 0x34),
    Uint8Array.of(0xff, 0xd9),
  );
}

function pngChunk(type, data) {
  return concat(u32be(data.length), ascii(type), data, new Uint8Array(4));
}

function validPng({ exif = true } = {}) {
  const header = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0);
  const chunks = [pngChunk("IHDR", header)];
  if (exif) chunks.push(pngChunk("eXIf", concat(ascii("Exif\0\0"), ascii("-34.5566"))));
  chunks.push(pngChunk("tEXt", ascii("Comment\0dueño del auto")));
  chunks.push(pngChunk("IDAT", Uint8Array.of(0)));
  chunks.push(pngChunk("IEND", new Uint8Array()));
  return concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ...chunks);
}

function webpChunk(type, data) {
  const padded = data.length % 2 === 0 ? data : concat(data, Uint8Array.of(0));
  return concat(ascii(type), u32le(data.length), padded);
}

function validWebp({ exif = true } = {}) {
  const chunks = [];
  if (exif) {
    chunks.push(webpChunk("EXIF", ascii("Exif\0\0-57.99")));
  }
  const vp8x = Uint8Array.of(0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  chunks.unshift(webpChunk("VP8X", vp8x));
  const vp8 = concat(Uint8Array.of(0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a), new Uint8Array(14));
  chunks.push(webpChunk("VP8 ", vp8));
  const body = concat(...chunks);
  return concat(ascii("RIFF"), u32le(4 + body.length), ascii("WEBP"), body);
}

function bytesInclude(bytes, text) {
  return new TextDecoder().decode(bytes).includes(text);
}

test("jpeg exif, comments and foreign APP0 are stripped and the file stays valid", async () => {
  const original = validJpeg();
  await inspectStockImage({ bytes: original, declaredContentType: "image/jpeg" });

  const stripped = stripImageMetadata(original, "image/jpeg");
  assert.equal(stripped.changed, true);
  assert.equal(bytesInclude(stripped.bytes, "Exif"), false);
  assert.equal(bytesInclude(stripped.bytes, "Comentario"), false);
  assert.equal(bytesInclude(stripped.bytes, "JFIF"), true);

  const inspection = await inspectStockImage({ bytes: stripped.bytes, declaredContentType: "image/jpeg" });
  assert.equal(inspection.contentType, "image/jpeg");

  const twice = stripImageMetadata(stripped.bytes, "image/jpeg");
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.bytes, stripped.bytes);
});

test("jpeg without metadata passes through unchanged", () => {
  const original = validJpeg({ exif: false, comment: false });
  const result = stripImageMetadata(original, "image/jpeg");
  assert.equal(result.changed, false);
  assert.deepEqual(result.bytes, original);
});

test("png exif and textual chunks are stripped and the file stays valid", async () => {
  const original = validPng();
  await inspectStockImage({ bytes: original, declaredContentType: "image/png" });

  const stripped = stripImageMetadata(original, "image/png");
  assert.equal(stripped.changed, true);
  assert.equal(bytesInclude(stripped.bytes, "Exif"), false);
  assert.equal(bytesInclude(stripped.bytes, "dueño"), false);

  await inspectStockImage({ bytes: stripped.bytes, declaredContentType: "image/png" });

  const twice = stripImageMetadata(stripped.bytes, "image/png");
  assert.equal(twice.changed, false);
});

test("webp exif chunk is removed and the VP8X flag is cleared", async () => {
  const original = validWebp();
  await inspectStockImage({ bytes: original, declaredContentType: "image/webp" });

  const stripped = stripImageMetadata(original, "image/webp");
  assert.equal(stripped.changed, true);
  assert.equal(bytesInclude(stripped.bytes, "Exif"), false);

  const view = new DataView(stripped.bytes.buffer, stripped.bytes.byteOffset, stripped.bytes.byteLength);
  assert.equal(view.getUint32(4, true) + 8, stripped.bytes.byteLength);

  const vp8xFlags = stripped.bytes[20];
  assert.equal(vp8xFlags & 0x08, 0);

  await inspectStockImage({ bytes: stripped.bytes, declaredContentType: "image/webp" });

  const twice = stripImageMetadata(stripped.bytes, "image/webp");
  assert.equal(twice.changed, false);
});

test("appraisal policy accepts only strippable formats", async () => {
  const jpeg = validJpeg({ exif: false, comment: false });
  await assert.doesNotReject(
    inspectAppraisalImage({ bytes: jpeg, declaredContentType: "image/jpeg" }),
  );
  await assert.rejects(
    inspectAppraisalImage({ bytes: jpeg, declaredContentType: "image/heic" }),
    (error) => error.code === "STOCK_IMAGE_UNSUPPORTED_CONTENT_TYPE",
  );
  await assert.rejects(
    inspectAppraisalImage({ bytes: jpeg, declaredContentType: "image/avif" }),
    (error) => error.code === "STOCK_IMAGE_UNSUPPORTED_CONTENT_TYPE",
  );
});

test("digest helper returns a sha-256 hex string", async () => {
  const digest = await digestImageSha256(new Uint8Array([1, 2, 3]));
  assert.match(digest, /^[0-9a-f]{64}$/);
});
