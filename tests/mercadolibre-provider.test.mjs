import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    if (specifier === "./mercadolibre-provider") return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) return { format: "module", source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceMap: false }), shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { searchMercadoLibreComparables, normalizeMercadoLibreItem, MERCADOLIBRE_LIMITS } = await import("../lib/server/mercadolibre-provider.ts");
const { runMarketAppraisal } = await import("../lib/server/market-appraisal.ts");
const query = { make: "ford", model: "focus", trim: "se", year: 2020, mileageKm: 80000, fuel: "nafta", transmission: "manual", region: "buenos aires", currency: "ARS" };
const config = { enabled: true, marketUseApproved: true, accessToken: "fixture-token-not-real" };
const now = new Date("2026-09-07T12:00:00Z");
const item = (id = "MLA123456") => ({ id, permalink: `https://auto.mercadolibre.com.ar/${id}?tracking=1`, price: 10000, currency_id: "ARS", condition: "used", status: "active", title: "secret title", seller: { phone: "secret PII" }, description: "secret body", location: { state: { name: "Buenos Aires" }, address_line: "secret address" }, attributes: [{ id: "BRAND", value_name: "Ford" }, { id: "MODEL", value_name: "Focus" }, { id: "TRIM", value_name: "SE" }, { id: "VEHICLE_YEAR", value_name: "2020" }, { id: "KILOMETERS", value_name: "80000 km" }, { id: "FUEL_TYPE", value_name: "Nafta" }, { id: "TRANSMISSION", value_name: "Manual" }] });
const response = (results = [], total = results.length, offset = 0) => Response.json({ results, paging: { total, offset, limit: 20 } });

test("missing flag, permission or token makes zero network calls", async () => {
  for (const patch of [{ enabled: false }, { marketUseApproved: false }, { accessToken: "" }, { accessToken: "bad\r\ntoken" }]) {
    const result = await runMarketAppraisal(query, { config: { ...config, ...patch }, fetcher: async () => { assert.fail("network forbidden"); } });
    assert.equal(result.status, "NOT_CONFIGURED");
    assert.equal(result.range, undefined);
  }
});
test("fixed official host, bearer only in header, no redirects, no caching and no PII projection", async () => {
  const batch = await searchMercadoLibreComparables(query, { config, now, fetcher: async (url, init) => {
    assert.equal(url.origin, "https://api.mercadolibre.com");
    assert.equal(url.pathname, "/sites/MLA/search");
    assert.ok(!String(url).includes(config.accessToken));
    assert.equal(init.headers.Authorization, `Bearer ${config.accessToken}`);
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    return response([item()]);
  } });
  assert.equal(batch.complete, true);
  assert.ok(!JSON.stringify(batch).includes("secret"));
  assert.equal(batch.comparables[0].priceKind, "UNVERIFIED");
  assert.equal(batch.comparables[0].permalink.includes("?"), false);
});
test("external links cannot carry credentials, hostile protocols or hosts", () => {
  for (const permalink of ["javascript:alert(1)", "https://auto.mercadolibre.com.ar.evil.test/a", "https://user:pass@auto.mercadolibre.com.ar/a", "https://auto.mercadolibre.com.ar:444/a"]) assert.equal(normalizeMercadoLibreItem({ ...item(), permalink }, now.toISOString()), null);
});
test("unverified asking price never enables a market estimate", async () => {
  const result = await runMarketAppraisal(query, { config, now, fetcher: async () => response(Array.from({ length: 5 }, (_, i) => item(`MLA12345${i}`))) });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.excluded.UNVERIFIED_PRICE, 5);
  assert.equal(result.range, undefined);
});
test("401/403/429/5xx are stable, sanitized and never retried", async () => {
  for (const [status, code] of [[401, "PROVIDER_ACCESS_DENIED"], [403, "PROVIDER_ACCESS_DENIED"], [429, "PROVIDER_RATE_LIMITED"], [503, "PROVIDER_UNAVAILABLE"]]) {
    let calls = 0;
    const result = await runMarketAppraisal(query, { config, fetcher: async () => { calls++; return new Response("secret upstream body", { status }); } });
    assert.equal(result.reason, code); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes("secret"));
  }
});
test("stream and declared lengths are bounded; malformed payloads and paging fail closed", async () => {
  const cases = [new Response("x", { headers: { "content-type": "application/json", "content-length": String(MERCADOLIBRE_LIMITS.responseBytes + 1) } }), new Response("x".repeat(MERCADOLIBRE_LIMITS.responseBytes + 1), { headers: { "content-type": "application/json" } }), Response.json({ results: [], paging: { total: 1, offset: 0, limit: 20 } }), new Response("<html>secret</html>", { headers: { "content-type": "text/html" } })];
  for (const res of cases) {
    const result = await runMarketAppraisal(query, { config, fetcher: async () => res });
    assert.equal(result.status, "PROVIDER_UNAVAILABLE"); assert.equal(result.range, undefined);
  }
});
test("pagination is bounded and truncation stays incomplete", async () => {
  let calls = 0;
  const batch = await searchMercadoLibreComparables(query, { config, now, fetcher: async (url) => {
    calls++; const offset = Number(url.searchParams.get("offset"));
    return response(Array.from({ length: 20 }, (_, i) => item(`MLA${100000 + offset + i}`)), 100, offset);
  } });
  assert.equal(calls, 3); assert.equal(batch.complete, false); assert.equal(batch.comparables.length, 60);
});
test("deadline terminates a non-cooperative fetch and sanitizes exceptions", async () => {
  const result = await runMarketAppraisal(query, { config, timeoutMs: 5, fetcher: () => new Promise(() => {}) });
  assert.equal(result.reason, "PROVIDER_TIMEOUT");
  const thrown = await runMarketAppraisal(query, { config, fetcher: async () => { throw new Error("secret token: whatever"); } });
  assert.equal(thrown.reason, "PROVIDER_INVALID_RESPONSE"); assert.ok(!JSON.stringify(thrown).includes("secret"));
});
test("stalled response body is cancelled by the total deadline", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const result = await runMarketAppraisal(query, { config, timeoutMs: 5, fetcher: async () => new Response(stream, { headers: { "content-type": "application/json" } }) });
  assert.equal(result.reason, "PROVIDER_TIMEOUT"); assert.equal(cancelled, true);
});
test("changing page totals and malformed comparable records stay visible as incomplete or excluded", async () => {
  let calls = 0;
  const changed = await runMarketAppraisal(query, { config, fetcher: async (url) => {
    calls++;
    const offset = Number(url.searchParams.get("offset"));
    return response(Array.from({ length: 20 }, (_, i) => item(`MLA${200000 + offset + i}`)), calls === 1 ? 40 : 41, offset);
  } });
  assert.equal(changed.reason, "PROVIDER_RESULTS_CHANGED"); assert.equal(changed.comparables, undefined);
  const malformed = await runMarketAppraisal(query, { config, fetcher: async () => response([{}, item()]) });
  assert.equal(malformed.receivedCount, 2); assert.equal(malformed.excluded.INVALID_SOURCE_RECORD, 1);
});
