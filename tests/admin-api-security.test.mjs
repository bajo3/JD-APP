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

const authenticatedAccount = Object.freeze({
  id: "operator-1",
  email: "Operator@Example.com",
  name: "Jesús Díaz",
  phoneNormalized: null,
  leadId: null,
  status: "ACTIVE",
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  version: 1,
  createdAt: "2026-09-04T00:00:00.000Z",
});

function request(headers = {}, body) {
  return new Request("https://example.test/api/v1/admin/overview", {
    method: body === undefined ? "GET" : "POST",
    headers,
    body,
  });
}

test("admin authentication fails closed for anonymous, missing configuration and denied users", async () => {
  await assert.rejects(
    () => authenticateAdminRequest(request(), {
      allowedEmails: "operator@example.com",
      allowedAccountIds: "operator-1",
      async readSession() { return null; },
    }),
    (error) => error instanceof ApiError && error.status === 401 && error.code === "ADMIN_AUTH_REQUIRED",
  );
  await assert.rejects(
    () => authenticateAdminRequest(request(), {
      allowedEmails: "",
      allowedAccountIds: "operator-1",
      async readSession() { return authenticatedAccount; },
    }),
    (error) => error instanceof ApiError && error.status === 503 && error.code === "ADMIN_ACCESS_NOT_CONFIGURED",
  );
  await assert.rejects(
    () => authenticateAdminRequest(request(), {
      allowedEmails: "operator@example.com",
      allowedAccountIds: "operator-1",
      async readSession() {
        return { ...authenticatedAccount, email: "intruder@example.com" };
      },
    }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "ADMIN_FORBIDDEN",
  );
});

test("admin authentication accepts only the allowlisted account session", async () => {
  const actor = await authenticateAdminRequest(request({
    "oai-authenticated-user-id": "forged-header",
    "oai-authenticated-user-email": "forged@example.com",
  }), {
    allowedEmails: "operator@example.com",
    allowedAccountIds: "operator-1",
    async readSession() { return authenticatedAccount; },
  });
  assert.deepEqual(actor, {
    userId: "operator-1",
    email: "operator@example.com",
    displayName: "Jesús Díaz",
  });
});

test("admin API reuses safe JSON headers and the 64 KiB streaming body limit", async () => {
  const previous = process.env.PANEL_ALLOWED_EMAILS;
  const previousIds = process.env.PANEL_ALLOWED_ACCOUNT_IDS;
  process.env.PANEL_ALLOWED_EMAILS = "operator@example.com";
  process.env.PANEL_ALLOWED_ACCOUNT_IDS = "operator-1";
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
    if (previousIds === undefined) delete process.env.PANEL_ALLOWED_ACCOUNT_IDS;
    else process.env.PANEL_ALLOWED_ACCOUNT_IDS = previousIds;
  }
});
