import assert from "node:assert/strict";
import test from "node:test";

import {
  PanelAccessError,
  isPanelEmailAllowed,
  isPanelAccountAllowed,
  parsePanelAllowedAccountIds,
  parsePanelAccessConfiguration,
  parsePanelAllowedEmails,
  requirePanelUser,
} from "../lib/server/panel-auth.ts";

const authenticatedAccount = Object.freeze({
  id: "user-test-1",
  email: "Operador@Example.com",
  name: "Operador JDA",
  phoneNormalized: null,
  leadId: null,
  status: "ACTIVE",
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  version: 1,
  createdAt: "2026-09-04T00:00:00.000Z",
});

test("panel allowlist normalizes case, whitespace and duplicates", () => {
  assert.deepEqual(
    parsePanelAllowedEmails(
      " admin@example.com,OPERADOR@example.com, admin@example.com ",
    ),
    ["admin@example.com", "operador@example.com"],
  );
  assert.equal(
    isPanelEmailAllowed(" OPERADOR@EXAMPLE.COM ", "operador@example.com"),
    true,
  );
});

test("panel account ID allowlist accepts safe IDs and rejects malformed entries", () => {
  assert.deepEqual(
    parsePanelAllowedAccountIds(" user-test-1,00000000-0000-0000-0000-000000000000,user-test-1 "),
    ["user-test-1", "00000000-0000-0000-0000-000000000000"],
  );
  for (const configured of [undefined, "", " ", "user-test-1,", "bad id", ",user-test-1"]) {
    assert.throws(
      () => parsePanelAllowedAccountIds(configured),
      (error) => error instanceof PanelAccessError && error.code === "PANEL_ACCESS_NOT_CONFIGURED",
    );
  }
});

test("missing, blank and malformed configuration fail closed", () => {
  for (const configured of [undefined, "", "  ", "valid@example.com,", "invalid"]) {
    assert.throws(
      () => parsePanelAllowedEmails(configured),
      (error) =>
        error instanceof PanelAccessError &&
        error.code === "PANEL_ACCESS_NOT_CONFIGURED",
    );
  }
});

test("requirePanelUser derives the panel identity from an allowed account session", async () => {
  let receivedCookie = null;
  const user = await requirePanelUser("/panel", {
    allowedEmails: "operador@example.com",
    allowedAccountIds: "user-test-1",
    cookieHeader: "jda_session=test-token",
    async readSession(cookieHeader) {
      receivedCookie = cookieHeader;
      return authenticatedAccount;
    },
  });
  assert.equal(receivedCookie, "jda_session=test-token");
  assert.equal(user.userId, authenticatedAccount.id);
  assert.equal(user.normalizedEmail, "operador@example.com");
  assert.ok(Object.isFrozen(user));
});

test("panel access requires the same account to match both allowlists", async () => {
  const configuration = parsePanelAccessConfiguration({
    allowedEmails: "operador@example.com",
    allowedAccountIds: "user-test-1",
  });
  assert.equal(isPanelAccountAllowed(authenticatedAccount, configuration), true);
  assert.equal(
    isPanelAccountAllowed({ ...authenticatedAccount, id: "other-account" }, configuration),
    false,
  );
  assert.equal(
    isPanelAccountAllowed({ ...authenticatedAccount, email: "other@example.com" }, configuration),
    false,
  );
});

test("denied access does not leak the configured allowlist", async () => {
  const configured = "admin-secret@example.com";
  await assert.rejects(
    () =>
      requirePanelUser("/panel", {
        allowedEmails: configured,
        allowedAccountIds: "user-test-1",
        async readSession() {
          return authenticatedAccount;
        },
      }),
    (error) => {
      assert.ok(error instanceof PanelAccessError);
      assert.equal(error.code, "PANEL_ACCESS_DENIED");
      assert.equal(error.message.includes(configured), false);
      return true;
    },
  );
});

test("an anonymous panel request redirects to the existing account login", async () => {
  const redirectSignal = new Error("NEXT_REDIRECT");
  await assert.rejects(
    () => requirePanelUser("/panel/tasaciones", {
      allowedEmails: "operador@example.com",
      allowedAccountIds: "user-test-1",
      cookieHeader: null,
      async readSession() {
        return null;
      },
      redirect(destination) {
        assert.equal(destination, "/panel/tasaciones");
        throw redirectSignal;
      },
    }),
    (error) => error === redirectSignal,
  );
});
