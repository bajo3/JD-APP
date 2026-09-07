import assert from "node:assert/strict";
import test from "node:test";
import { estimateMarketAppraisal, normalizeMarketAppraisalQuery, marketPriceMinorUnits, MarketAppraisalError } from "../lib/domain/market-appraisal.mjs";

const now = new Date("2026-09-07T12:00:00.000Z");
const query = { make: "Ford", model: "Focus", trim: "SE", year: 2020, mileageKm: 80_000, fuel: "Nafta", transmission: "Manual", region: "Buenos Aires", currency: "ARS" };
const row = (id, priceCents = 100_000) => ({ ...query, sourceItemId: id, status: "active", condition: "used", priceKind: "ASKING_TOTAL", priceCents, observedAt: now.toISOString() });
const batch = (rows = [100, 105, 110, 115, 120].map((price, i) => row(`item-${i}`, price * 100))) => ({ fetchedAt: now.toISOString(), complete: true, comparables: rows });

test("query contract rejects unknown fields, missing variants, coerced numbers and currencies", () => {
  assert.equal(normalizeMarketAppraisalQuery(query, now).make, "ford");
  for (const patch of [{ trim: "" }, { mileageKm: -1 }, { year: "2020" }, { currency: "EUR" }, { approved: true }]) assert.throws(() => normalizeMarketAppraisalQuery({ ...query, ...patch }, now), MarketAppraisalError);
});
test("decimal money is exact, positive, safe and rejects fractional cents", () => {
  assert.equal(marketPriceMinorUnits("123.45"), 12345);
  assert.equal(marketPriceMinorUnits(0.29), 29);
  for (const value of [0, -1, "1.001", "1e10", NaN, Infinity, "90071992547409.92", true]) assert.equal(marketPriceMinorUnits(value), null);
});
test("five comparable prices yield deterministic quantiles, median and explicit review", () => {
  const result = estimateMarketAppraisal(query, batch(), now);
  assert.equal(result.status, "READY_FOR_REVIEW");
  assert.deepEqual(result.range, { lowCents: 10500, baseCents: 11000, highCents: 11500, currency: "ARS" });
  assert.equal(result.requiresReview, true);
  assert.equal(result.commercialPolicyApproved, false);
  assert.equal(result.validUntil, "2026-09-08T12:00:00.000Z");
  assert.deepEqual(estimateMarketAppraisal(query, batch(batch().comparables.toReversed()), now), result);
});
test("each mismatch excludes a comparable and no undersized sample returns an amount", () => {
  for (const patch of [{ make: "Renault" }, { trim: "Titanium" }, { year: 2021 }, { fuel: "Diesel" }, { transmission: "Automática" }, { region: "Córdoba" }, { mileageKm: 100001 }, { currency: "USD" }, { priceKind: "UNVERIFIED" }, { status: "closed" }, { condition: "new" }, { priceCents: 0 }]) {
    const rows = batch().comparables;
    rows[0] = { ...rows[0], ...patch };
    const result = estimateMarketAppraisal(query, batch(rows), now);
    assert.equal(result.estimable, false, JSON.stringify(patch));
    assert.equal(result.range, undefined);
  }
});
test("duplicate IDs cannot increase sample or select a favorable observation by ordering", () => {
  const rows = [...batch().comparables, { ...batch().comparables[0], priceCents: 999999 }];
  const a = estimateMarketAppraisal(query, batch(rows), now), b = estimateMarketAppraisal(query, batch(rows.toReversed()), now);
  assert.equal(a.estimable, false);
  assert.equal(b.estimable, false);
  assert.equal(a.eligibleCount, 4);
});
test("Tukey exclusion precedes minimum sample check and high dispersion never estimates", () => {
  const result = estimateMarketAppraisal(query, batch([...batch().comparables, row("outlier", 100000)]), now);
  assert.equal(result.excluded.OUTLIER, 1);
  assert.equal(result.includedCount, 5);
  const broad = estimateMarketAppraisal(query, batch([100, 200, 300, 400, 500].map((p, i) => row(String(i), p))), now);
  assert.equal(broad.reason, "EXCESSIVE_DISPERSION");
  assert.equal(broad.range, undefined);
});
test("fetched and observed timestamps use finite server time and exclusive expiration", () => {
  assert.equal(estimateMarketAppraisal(query, { ...batch(), fetchedAt: "2026-09-06T12:00:00.000Z" }, now).status, "STALE");
  assert.equal(estimateMarketAppraisal(query, { ...batch(), fetchedAt: "2026-09-08T12:00:00.000Z" }, now).status, "STALE");
  const rows = batch().comparables;
  rows[0] = { ...rows[0], observedAt: "2026-09-06T13:00:00.000Z" };
  assert.equal(estimateMarketAppraisal(query, batch(rows), now).validUntil, "2026-09-07T13:00:00.000Z");
  assert.equal(estimateMarketAppraisal(query, { ...batch(), complete: false }, now).reason, "PARTIAL_SOURCE");
});
