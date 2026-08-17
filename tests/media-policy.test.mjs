import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STOCK_IMAGE_BYTES,
  MEDIA_POLICY_ERROR_CODES,
  MediaPolicyError,
  STOCK_IMAGE_CONTENT_TYPES,
  inspectStockImage,
} from "../lib/media/index.mjs";

function concat(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function ascii(value) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function u32be(value) {
  return Uint8Array.of(
    Math.floor(value / 2 ** 24) & 0xff,
    Math.floor(value / 2 ** 16) & 0xff,
    Math.floor(value / 2 ** 8) & 0xff,
    value & 0xff,
  );
}

function u32le(value) {
  return Uint8Array.of(
    value & 0xff,
    Math.floor(value / 2 ** 8) & 0xff,
    Math.floor(value / 2 ** 16) & 0xff,
    Math.floor(value / 2 ** 24) & 0xff,
  );
}

function jpeg(scanByteSize = 3) {
  const frame = Uint8Array.of(
    0xff, 0xc0, 0x00, 0x0b,
    0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  );
  const scan = Uint8Array.of(
    0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  );
  return concat(
    Uint8Array.of(0xff, 0xd8),
    frame,
    scan,
    new Uint8Array(scanByteSize),
    Uint8Array.of(0xff, 0xd9),
  );
}

function pngChunk(type, data) {
  return concat(u32be(data.length), ascii(type), data, new Uint8Array(4));
}

function png() {
  const header = Uint8Array.of(
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00,
  );
  return concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Uint8Array.of(0x00)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function webp() {
  const data = Uint8Array.of(0x2f, 0x00, 0x00, 0x00, 0x00);
  const chunk = concat(ascii("VP8L"), u32le(data.length), data, Uint8Array.of(0));
  return concat(ascii("RIFF"), u32le(4 + chunk.length), ascii("WEBP"), chunk);
}

function isoBox(type, data) {
  return concat(u32be(8 + data.length), ascii(type), data);
}

function avif() {
  return concat(
    isoBox(
      "ftyp",
      concat(ascii("avif"), new Uint8Array(4), ascii("mif1"), ascii("avif")),
    ),
    isoBox("meta", new Uint8Array(4)),
  );
}

const samples = Object.freeze([
  ["image/jpeg", jpeg()],
  ["image/png", png()],
  ["image/webp", webp()],
  ["image/avif", avif()],
]);

function hasCode(code) {
  return (error) => error instanceof MediaPolicyError && error.code === code;
}

test("accepts JPEG, PNG, WebP and AVIF signatures with immutable JSON metadata", async () => {
  assert.deepEqual(STOCK_IMAGE_CONTENT_TYPES, [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
  ]);
  for (const [contentType, bytes] of samples) {
    const result = await inspectStockImage({ bytes, declaredContentType: contentType });
    assert.deepEqual(Object.keys(result), ["contentType", "byteSize", "sha256"]);
    assert.equal(result.contentType, contentType);
    assert.equal(result.byteSize, bytes.byteLength);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Object.isFrozen(result));
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("normalizes MIME case and ignores harmless declared parameters", async () => {
  const result = await inspectStockImage({
    bytes: png(),
    declaredContentType: " IMAGE/PNG; charset=binary ",
  });
  assert.equal(result.contentType, "image/png");
});

test("accepts exactly 5 MiB and rejects the following byte", async () => {
  const baseSize = jpeg(0).byteLength;
  const exact = jpeg(MAX_STOCK_IMAGE_BYTES - baseSize);
  assert.equal(exact.byteLength, MAX_STOCK_IMAGE_BYTES);
  const result = await inspectStockImage({ bytes: exact, declaredContentType: "image/jpeg" });
  assert.equal(result.byteSize, MAX_STOCK_IMAGE_BYTES);

  await assert.rejects(
    () => inspectStockImage({
      bytes: new Uint8Array(MAX_STOCK_IMAGE_BYTES + 1),
      declaredContentType: "image/jpeg",
    }),
    hasCode(MEDIA_POLICY_ERROR_CODES.TOO_LARGE),
  );
});

test("rejects invalid byte inputs, empty content and unsupported MIME", async () => {
  await assert.rejects(
    () => inspectStockImage({ bytes: "not-binary", declaredContentType: "image/jpeg" }),
    hasCode(MEDIA_POLICY_ERROR_CODES.INVALID_BYTES),
  );
  await assert.rejects(
    () => inspectStockImage({ bytes: new Uint8Array(), declaredContentType: "image/jpeg" }),
    hasCode(MEDIA_POLICY_ERROR_CODES.EMPTY),
  );
  await assert.rejects(
    () => inspectStockImage({ bytes: jpeg(), declaredContentType: "image/gif" }),
    hasCode(MEDIA_POLICY_ERROR_CODES.UNSUPPORTED_CONTENT_TYPE),
  );
});

test("rejects declared MIME spoofing for every supported signature", async () => {
  for (let index = 0; index < samples.length; index += 1) {
    const [, bytes] = samples[index];
    const wrongType = samples[(index + 1) % samples.length][0];
    await assert.rejects(
      () => inspectStockImage({ bytes, declaredContentType: wrongType }),
      hasCode(MEDIA_POLICY_ERROR_CODES.CONTENT_TYPE_MISMATCH),
    );
  }
});

test("rejects unknown signatures and structurally malformed spoof files", async () => {
  await assert.rejects(
    () => inspectStockImage({
      bytes: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
      declaredContentType: "image/png",
    }),
    hasCode(MEDIA_POLICY_ERROR_CODES.INVALID_SIGNATURE),
  );
  const fakePng = concat(
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IEND", new Uint8Array()),
  );
  await assert.rejects(
    () => inspectStockImage({ bytes: fakePng, declaredContentType: "image/png" }),
    hasCode(MEDIA_POLICY_ERROR_CODES.MALFORMED),
  );
});

test("rejects truncation independently for every supported format", async () => {
  for (const [contentType, bytes] of samples) {
    await assert.rejects(
      () => inspectStockImage({
        bytes: bytes.subarray(0, bytes.byteLength - 1),
        declaredContentType: contentType,
      }),
      hasCode(MEDIA_POLICY_ERROR_CODES.TRUNCATED),
    );
  }
});

test("SHA-256 is deterministic and changes with binary content", async () => {
  const first = await inspectStockImage({ bytes: jpeg(3), declaredContentType: "image/jpeg" });
  const replay = await inspectStockImage({ bytes: jpeg(3), declaredContentType: "image/jpeg" });
  const different = await inspectStockImage({ bytes: jpeg(4), declaredContentType: "image/jpeg" });
  assert.equal(first.sha256, replay.sha256);
  assert.equal(first.sha256, "be7cf477b989bd005caf76ac497019a70223295985744a533816d6f633a3ac78");
  assert.notEqual(first.sha256, different.sha256);
});

test("stable errors serialize without binary data", async () => {
  await assert.rejects(
    () => inspectStockImage({ bytes: new Uint8Array(), declaredContentType: "image/png" }),
    (error) => {
      assert.deepEqual(error.toJSON(), {
        code: "STOCK_IMAGE_EMPTY",
        message: "La imagen está vacía.",
      });
      assert.equal(JSON.stringify(error.toJSON()).includes("bytes"), false);
      return true;
    },
  );
});
