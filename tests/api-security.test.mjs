import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  MAX_JSON_BODY_BYTES,
  apiRoute,
  json,
  readJsonObject,
  requireIdempotencyKey,
  stableToken,
} from "../lib/server/api.ts";

function request(body, headers = {}) {
  return new Request("https://app.local/api/v1/test", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body,
  });
}

test("readJsonObject accepts standard and vendor JSON content types", async () => {
  assert.deepEqual(await readJsonObject(request('{"ok":true}')), { ok: true });
  assert.deepEqual(
    await readJsonObject(request('{"ok":true}', { "Content-Type": "application/problem+json" })),
    { ok: true },
  );
});

test("readJsonObject rejects missing or non-JSON media types before parsing", async () => {
  const missing = new Request("https://app.local/api/v1/test", {
    method: "POST",
    body: '{"ok":true}',
  });
  await assert.rejects(
    () => readJsonObject(missing),
    (error) => error instanceof ApiError && error.status === 415 && error.code === "UNSUPPORTED_MEDIA_TYPE",
  );
  await assert.rejects(
    () => readJsonObject(request('{"ok":true}', { "Content-Type": "text/plain" })),
    (error) => error instanceof ApiError && error.status === 415 && error.code === "UNSUPPORTED_MEDIA_TYPE",
  );
});

test("readJsonObject returns stable errors for malformed JSON and non-object payloads", async () => {
  await assert.rejects(
    () => readJsonObject(request("{")),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "INVALID_JSON",
  );
  await assert.rejects(
    () => readJsonObject(request("[]")),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "INVALID_PAYLOAD",
  );
});

test("body limit rejects a declared oversized payload without consuming it", async () => {
  const oversized = request("{}", { "Content-Length": String(MAX_JSON_BODY_BYTES + 1) });
  await assert.rejects(
    () => readJsonObject(oversized),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE",
  );
  assert.equal(oversized.bodyUsed, false);
});

test("body limit stops a chunked stream as soon as it exceeds 64 KiB", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(16 * 1024).fill(97);
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request("https://app.local/api/v1/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  });
  await assert.rejects(
    () => readJsonObject(streamed),
    (error) => error instanceof ApiError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE",
  );
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6, `the reader pulled too many chunks: ${pulls}`);
});

test("a valid JSON object exactly at the byte limit is accepted", async () => {
  const overhead = new TextEncoder().encode('{"value":""}').byteLength;
  const body = JSON.stringify({ value: "x".repeat(MAX_JSON_BODY_BYTES - overhead) });
  assert.equal(new TextEncoder().encode(body).byteLength, MAX_JSON_BODY_BYTES);
  const parsed = await readJsonObject(request(body));
  assert.equal(parsed.value.length, MAX_JSON_BODY_BYTES - overhead);
});

test("API responses force safe JSON headers and never expose internal exception details", async () => {
  const direct = json({ ok: true }, { headers: { "X-Content-Type-Options": "unsafe" } });
  assert.equal(direct.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(direct.headers.get("cache-control"), "no-store");
  assert.equal(direct.headers.get("x-content-type-options"), "nosniff");
  assert.equal(direct.headers.get("referrer-policy"), "no-referrer");

  const originalError = console.error;
  console.error = () => {};
  let response;
  try {
    response = await apiRoute(async () => {
      throw new Error("secret customer payload");
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.deepEqual(payload, {
    error: { code: "INTERNAL_ERROR", message: "No pudimos completar la operación." },
  });
  assert.equal(JSON.stringify(payload).includes("secret customer payload"), false);
});

test("idempotency keys are validated and deterministic tokens replay identically", async () => {
  const valid = new Request("https://app.local", {
    headers: { "Idempotency-Key": "lead:browser-0001" },
  });
  assert.equal(requireIdempotencyKey(valid), "lead:browser-0001");
  assert.throws(
    () => requireIdempotencyKey(new Request("https://app.local")),
    (error) => error instanceof ApiError && error.code === "IDEMPOTENCY_KEY_REQUIRED",
  );
  assert.equal(await stableToken("same-request", 24), await stableToken("same-request", 24));
  assert.notEqual(await stableToken("same-request", 24), await stableToken("other-request", 24));
});
