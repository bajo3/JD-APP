import assert from "node:assert/strict";
import test from "node:test";

import {
  PanelAccessError,
  isPanelEmailAllowed,
  parsePanelAllowedEmails,
  requirePanelUser,
} from "../lib/server/panel-auth.ts";

const authenticatedUser = Object.freeze({
  userId: "user-test-1",
  displayName: "Operador",
  email: "Operador@Example.com",
  fullName: "Operador JDA",
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

test("requirePanelUser preserves SIWC identity for an allowed account", async () => {
  let requestedReturnTo = null;
  const user = await requirePanelUser("/panel", {
    allowedEmails: "operador@example.com",
    async requireUser(returnTo) {
      requestedReturnTo = returnTo;
      return authenticatedUser;
    },
  });
  assert.equal(requestedReturnTo, "/panel");
  assert.equal(user.userId, authenticatedUser.userId);
  assert.equal(user.normalizedEmail, "operador@example.com");
  assert.ok(Object.isFrozen(user));
});

test("denied access does not leak the configured allowlist", async () => {
  const configured = "admin-secret@example.com";
  await assert.rejects(
    () =>
      requirePanelUser("/panel", {
        allowedEmails: configured,
        async requireUser() {
          return authenticatedUser;
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

test("SIWC redirects and failures are not swallowed", async () => {
  const redirectSignal = new Error("NEXT_REDIRECT");
  await assert.rejects(
    () =>
      requirePanelUser("/panel", {
        allowedEmails: "operador@example.com",
        async requireUser() {
          throw redirectSignal;
        },
      }),
    (error) => error === redirectSignal,
  );
});
