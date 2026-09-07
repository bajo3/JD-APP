import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
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
              : relative.endsWith(".mjs")
                ? relative
                : `${relative}.ts`,
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
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceMap: false }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { adminMarketAppraisals } = await import("../lib/server/market-appraisal-handler.ts");
const { runMarketAppraisal } = await import("../lib/server/market-appraisal.ts");

const account = Object.freeze({
  id: "operator-1", email: "operator@example.com", name: "Operador", phoneNormalized: null,
  leadId: null, status: "ACTIVE", failedAttempts: 0, lockedUntil: null, lastLoginAt: null,
  version: 1, createdAt: "2026-09-07T00:00:00.000Z",
});
const auth = Object.freeze({
  allowedEmails: "operator@example.com",
  allowedAccountIds: "operator-1",
  async readSession() { return account; },
});
function request(body, headers = {}) {
  return new Request("https://jda.test/api/v1/admin/market-appraisals", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.20", ...headers },
    body: JSON.stringify(body),
  });
}
function rateLimit(counter) {
  return {
    repository: {
      async hit() { counter.hits += 1; return { hits: 1 }; },
      async removeExpired() {},
    },
    now: new Date("2026-09-07T12:00:00.000Z"),
  };
}
const query = { make: "Ford", model: "Focus", trim: "SE", year: 2020, mileageKm: 80000, fuel: "Nafta", transmission: "Manual", region: "Buenos Aires", currency: "ARS" };

test("admin authorization runs before the rate limiter and any market-provider work", async () => {
  let ran = false;
  const counter = { hits: 0 };
  const response = await adminMarketAppraisals(request(query), {
    auth: { ...auth, async readSession() { return null; } },
    rateLimit: rateLimit(counter),
    async run() { ran = true; return { status: "READY_FOR_REVIEW" }; },
  });
  assert.equal(response.status, 401);
  assert.equal(counter.hits, 0);
  assert.equal(ran, false);
});

test("validated authenticated query returns the sanitized service result", async () => {
  const counter = { hits: 0 };
  const response = await adminMarketAppraisals(request(query), {
    auth,
    rateLimit: rateLimit(counter),
    async run(payload) {
      assert.deepEqual(payload, query);
      return { status: "NOT_CONFIGURED", estimable: false, requiresReview: true };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(counter.hits, 1);
  const body = await response.json();
  assert.equal(body.data.status, "NOT_CONFIGURED");
  assert.ok(body.meta.serverNow);
});

test("invalid market input is a stable 422 and never reaches the provider", async () => {
  const counter = { hits: 0 };
  const response = await adminMarketAppraisals(request({ ...query, trim: "" }), {
    auth,
    rateLimit: rateLimit(counter),
    run: runMarketAppraisal,
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "INVALID_MARKET_QUERY");
  assert.equal(counter.hits, 1);
});
