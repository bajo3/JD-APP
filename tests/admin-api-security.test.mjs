import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { ApiError, apiRoute, json, readJsonObject } from "../lib/server/api.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { authenticateAdminRequest } = await import("../lib/server/admin-auth.ts");

function request(headers = {}, body) {
  return new Request("https://example.test/api/v1/admin/overview", {
    method: body === undefined ? "GET" : "POST",
    headers,
    body,
  });
}

test("admin authentication fails closed for anonymous, missing configuration and denied users", () => {
  assert.throws(
    () => authenticateAdminRequest(request(), { allowedEmails: "operator@example.com" }),
    (error) => error instanceof ApiError && error.status === 401 && error.code === "ADMIN_AUTH_REQUIRED",
  );
  assert.throws(
    () => authenticateAdminRequest(request({
      "oai-authenticated-user-id": "operator-1",
      "oai-authenticated-user-email": "operator@example.com",
    }), { allowedEmails: "" }),
    (error) => error instanceof ApiError && error.status === 503 && error.code === "ADMIN_ACCESS_NOT_CONFIGURED",
  );
  assert.throws(
    () => authenticateAdminRequest(request({
      "oai-authenticated-user-id": "intruder-1",
      "oai-authenticated-user-email": "intruder@example.com",
    }), { allowedEmails: "operator@example.com" }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "ADMIN_FORBIDDEN",
  );
});

test("admin authentication accepts only the allowlisted identity and decodes its display name", () => {
  const actor = authenticateAdminRequest(request({
    "oai-authenticated-user-id": "operator-1",
    "oai-authenticated-user-email": "Operator@Example.com",
    "oai-authenticated-user-full-name": "Jes%C3%BAs%20D%C3%ADaz",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  }), { allowedEmails: "operator@example.com" });
  assert.deepEqual(actor, {
    userId: "operator-1",
    email: "operator@example.com",
    displayName: "Jesús Díaz",
  });
});

test("admin API reuses safe JSON headers and the 64 KiB streaming body limit", async () => {
  const previous = process.env.PANEL_ALLOWED_EMAILS;
  process.env.PANEL_ALLOWED_EMAILS = "operator@example.com";
  try {
    const headers = {
      "content-type": "application/json",
      "oai-authenticated-user-id": "operator-1",
      "oai-authenticated-user-email": "operator@example.com",
    };
    const response = await apiRoute(async () => {
        await readJsonObject(request(headers, JSON.stringify({ payload: "x".repeat(70 * 1024) })));
        return json({ data: null });
      });
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
  } finally {
    if (previous === undefined) delete process.env.PANEL_ALLOWED_EMAILS;
    else process.env.PANEL_ALLOWED_EMAILS = previous;
  }
});
