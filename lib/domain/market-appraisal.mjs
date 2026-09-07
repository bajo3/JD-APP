/** Internal market research only. These technical thresholds are not JDA pricing rules. */
export const MARKET_APPRAISAL_METHOD = "jda-market-asking-price.v1";
export const MARKET_APPRAISAL_POLICY = Object.freeze({ minimumComparables: 5, freshnessHours: 24, mileageWindowKm: 20_000, maxDispersionBps: 3_500 });
export const MARKET_APPRAISAL_NOTICE = "Referencia de precios publicados, no de operaciones cerradas ni del valor de toma de JDA. Requiere revisión humana. Metodología técnica pendiente de validación comercial.";

export class MarketAppraisalError extends Error {
  constructor(code, message) { super(message); this.name = "MarketAppraisalError"; this.code = code; }
}
const normalized = (value) => typeof value === "string" ? value.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ") : "";
const invalid = () => { throw new MarketAppraisalError("INVALID_MARKET_QUERY", "Completá marca, modelo, versión, año, kilometraje, combustible, transmisión, región y moneda."); };
const hasControlCharacter = (value) => Array.from(value).some((character) => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 31 || code === 127;
});

export function normalizeMarketAppraisalQuery(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const fields = ["make", "model", "trim", "fuel", "transmission", "region"];
  const allowed = new Set([...fields, "year", "mileageKm", "currency"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid();
  const result = {};
  for (const field of fields) {
    const value = normalized(input[field]);
    if (!value || value.length > 80 || hasControlCharacter(value)) invalid();
    result[field] = value;
  }
  if (!Number.isSafeInteger(input.year) || input.year < 1950 || input.year > now.getUTCFullYear() + 1 ||
      !Number.isSafeInteger(input.mileageKm) || input.mileageKm < 0 || input.mileageKm > 3_000_000 ||
      !["ARS", "USD"].includes(input.currency)) invalid();
  return Object.freeze({ ...result, year: input.year, mileageKm: input.mileageKm, currency: input.currency });
}

/** Exact decimal parsing: currency fractions are never rounded from binary floats. */
export function marketPriceMinorUnits(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = /^(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function marketNoEstimate(status, reason, extra = {}) {
  return Object.freeze({ status, reason, estimable: false, requiresReview: true, methodologyVersion: MARKET_APPRAISAL_METHOD,
    policy: MARKET_APPRAISAL_POLICY, commercialPolicyApproved: false, notice: MARKET_APPRAISAL_NOTICE, ...extra });
}

const quantile = (sorted, fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
function median(sorted) {
  const center = Math.floor(sorted.length / 2);
  // Avoid adding two potentially large safe integers.
  return sorted.length % 2 ? sorted[center] : sorted[center - 1] + Math.floor((sorted[center] - sorted[center - 1]) / 2);
}

/** Pure, deterministic and never mutates a ruleset, an appraisal or provider input. */
export function estimateMarketAppraisal(queryInput, batch, now = new Date()) {
  const query = normalizeMarketAppraisalQuery(queryInput, now);
  const fetchedMs = Date.parse(batch?.fetchedAt);
  const duration = MARKET_APPRAISAL_POLICY.freshnessHours * 3_600_000;
  if (!Number.isFinite(fetchedMs) || fetchedMs > now.getTime() || now.getTime() >= fetchedMs + duration) {
    return marketNoEstimate("STALE", "SOURCE_STALE");
  }
  if (batch?.complete !== true || !Array.isArray(batch.comparables)) return marketNoEstimate("PROVIDER_UNAVAILABLE", "PARTIAL_SOURCE");
  const excluded = {};
  const discardedCount = Number.isSafeInteger(batch.discardedCount) && batch.discardedCount > 0 ? batch.discardedCount : 0;
  if (discardedCount) excluded.INVALID_SOURCE_RECORD = discardedCount;
  const reject = (reason) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const ids = new Set();
  const valid = [];
  for (const row of batch.comparables) {
    if (!row || typeof row.sourceItemId !== "string" || !row.sourceItemId) { reject("INVALID_RECORD"); continue; }
    // All observations of a duplicated ID are dropped below, irrespective of input order.
    if (ids.has(row.sourceItemId)) { reject("DUPLICATE"); continue; }
    ids.add(row.sourceItemId);
    if (row.status !== "active" || row.condition !== "used") { reject("NOT_ACTIVE_USED"); continue; }
    if (["make", "model", "trim", "fuel", "transmission", "region"].some((key) => normalized(row[key]) !== query[key]) || row.year !== query.year) { reject("VEHICLE_MISMATCH"); continue; }
    if (!Number.isSafeInteger(row.mileageKm) || row.mileageKm < 0 || Math.abs(row.mileageKm - query.mileageKm) > MARKET_APPRAISAL_POLICY.mileageWindowKm) { reject("MILEAGE_MISMATCH"); continue; }
    if (row.currency !== query.currency) { reject("CURRENCY_MISMATCH"); continue; }
    if (row.priceKind !== "ASKING_TOTAL") { reject("UNVERIFIED_PRICE"); continue; }
    if (!Number.isSafeInteger(row.priceCents) || row.priceCents <= 0) { reject("INVALID_PRICE"); continue; }
    const observed = Date.parse(row.observedAt);
    if (!Number.isFinite(observed) || observed > now.getTime() || now.getTime() >= observed + duration) { reject("STALE_RECORD"); continue; }
    valid.push(row);
  }
  const occurrences = new Map();
  for (const row of batch.comparables) if (row?.sourceItemId) occurrences.set(row.sourceItemId, (occurrences.get(row.sourceItemId) ?? 0) + 1);
  const unique = valid.filter((row) => occurrences.get(row.sourceItemId) === 1);
  const base = { fetchedAt: batch.fetchedAt, excluded, receivedCount: batch.comparables.length + discardedCount, eligibleCount: unique.length, currency: query.currency };
  if (unique.length < MARKET_APPRAISAL_POLICY.minimumComparables) return marketNoEstimate("INSUFFICIENT_DATA", "TOO_FEW_COMPARABLES", base);
  const prices = unique.map((row) => row.priceCents).sort((a, b) => a - b);
  const q1 = quantile(prices, 0.25), q3 = quantile(prices, 0.75), iqr = q3 - q1;
  // With IQR zero retain only the repeated central price; do not invent a fallback spread.
  const included = unique.filter((row) => row.priceCents >= q1 - iqr * 1.5 && row.priceCents <= q3 + iqr * 1.5);
  excluded.OUTLIER = unique.length - included.length;
  if (included.length < MARKET_APPRAISAL_POLICY.minimumComparables) return marketNoEstimate("INSUFFICIENT_DATA", "TOO_FEW_AFTER_OUTLIERS", { ...base, includedCount: included.length });
  const sorted = included.map((row) => row.priceCents).sort((a, b) => a - b);
  const lowCents = quantile(sorted, 0.25), highCents = quantile(sorted, 0.75), baseCents = median(sorted);
  if ((highCents - lowCents) / baseCents * 10_000 > MARKET_APPRAISAL_POLICY.maxDispersionBps) return marketNoEstimate("INSUFFICIENT_DATA", "EXCESSIVE_DISPERSION", base);
  const validUntil = new Date(Math.min(fetchedMs, ...included.map((row) => Date.parse(row.observedAt))) + duration).toISOString();
  return Object.freeze({ ...base, status: "READY_FOR_REVIEW", estimable: true, requiresReview: true,
    commercialPolicyApproved: false, methodologyVersion: MARKET_APPRAISAL_METHOD, policy: MARKET_APPRAISAL_POLICY,
    notice: MARKET_APPRAISAL_NOTICE, includedCount: included.length, sourceItemIds: included.map((row) => row.sourceItemId).sort(),
    validUntil, range: Object.freeze({ lowCents, baseCents, highCents, currency: query.currency }) });
}
