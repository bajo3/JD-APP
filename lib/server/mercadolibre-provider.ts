import "server-only";
import { marketPriceMinorUnits } from "../domain/market-appraisal.mjs";

export type MarketQuery = Readonly<{ make: string; model: string; trim: string; year: number; mileageKm: number; fuel: string; transmission: string; region: string; currency: "ARS" | "USD" }>;
export type MarketComparable = Readonly<{ sourceItemId: string; source: "MERCADOLIBRE"; permalink: string; make: string; model: string; trim: string; year: number | null; mileageKm: number | null; fuel: string; transmission: string; region: string; status: string; condition: string; currency: string; priceCents: number | null; priceKind: "UNVERIFIED" | "ASKING_TOTAL"; observedAt: string }>;
export type MarketBatch = Readonly<{ source: "MERCADOLIBRE"; fetchedAt: string; complete: boolean; comparables: readonly MarketComparable[]; discardedCount: number }>;
export type MercadoLibreConfig = Readonly<{ enabled: boolean; marketUseApproved: boolean; accessToken?: string }>;
export class MercadoLibreProviderError extends Error {
  constructor(readonly code: string) { super("La fuente de mercado no está disponible."); this.name = "MercadoLibreProviderError"; }
}
export const MERCADOLIBRE_LIMITS = Object.freeze({ timeoutMs: 12_000, responseBytes: 512 * 1024, pageSize: 20, maxPages: 3 });
export function mercadoLibreConfiguration(): MercadoLibreConfig {
  return { enabled: process.env.MERCADOLIBRE_MARKET_APPRAISAL_ENABLED === "true", marketUseApproved: process.env.MERCADOLIBRE_MARKET_USE_APPROVED === "true", accessToken: process.env.MERCADOLIBRE_ACCESS_TOKEN?.trim() };
}
export function mercadoLibreConfigured(config: MercadoLibreConfig): boolean {
  return config.enabled && config.marketUseApproved && typeof config.accessToken === "string" && config.accessToken.length > 0 && config.accessToken.length <= 4096 && !/[\r\n]/.test(config.accessToken);
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 120) : "";

/** Projection deliberately discards seller, title, descriptions, addresses and photos. */
export function normalizeMercadoLibreItem(raw: unknown, observedAt: string): MarketComparable | null {
  const item = record(raw);
  if (typeof item.id !== "string" || !/^MLA\d{5,20}$/.test(item.id)) return null;
  let permalink: URL;
  if (typeof item.permalink !== "string" || item.permalink.length > 2048) return null;
  try { permalink = new URL(item.permalink); } catch { return null; }
  if (permalink.protocol !== "https:" || !["auto.mercadolibre.com.ar", "articulo.mercadolibre.com.ar", "www.mercadolibre.com.ar"].includes(permalink.hostname) || permalink.username || permalink.password || permalink.port) return null;
  permalink.search = ""; permalink.hash = "";
  const attributes = Array.isArray(item.attributes) ? item.attributes.map(record) : [];
  const attribute = (id: string) => attributes.find((row) => row.id === id);
  const name = (id: string) => text(attribute(id)?.value_name);
  const int = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const mileage = attribute("KILOMETERS");
  const structured = record(mileage?.value_struct);
  const mileageKm = structured.unit === "km" && Number.isSafeInteger(structured.number) ? Number(structured.number) : /^\d+ km$/.test(name("KILOMETERS")) ? int(name("KILOMETERS").slice(0, -3)) : null;
  return Object.freeze({ sourceItemId: item.id, source: "MERCADOLIBRE", permalink: permalink.href,
    make: name("BRAND"), model: name("MODEL"), trim: name("TRIM"), year: int(name("VEHICLE_YEAR")), mileageKm,
    fuel: name("FUEL_TYPE"), transmission: name("TRANSMISSION"), region: text(record(record(item.location).state).name),
    status: text(item.status), condition: text(item.condition), currency: text(item.currency_id), priceCents: marketPriceMinorUnits(item.price),
    // The API's `price` alone does not prove that a vehicle advert quotes a total rather than a down payment.
    // Do not infer this from its title or a successful HTTP response.
    priceKind: "UNVERIFIED", observedAt });
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MERCADOLIBRE_LIMITS.responseBytes)) throw new MercadoLibreProviderError("PROVIDER_RESPONSE_TOO_LARGE");
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new MercadoLibreProviderError("PROVIDER_INVALID_RESPONSE");
  const reader = response.body?.getReader();
  if (!reader) throw new MercadoLibreProviderError("PROVIDER_INVALID_RESPONSE");
  let count = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      count += value.byteLength;
      if (count > MERCADOLIBRE_LIMITS.responseBytes) throw new MercadoLibreProviderError("PROVIDER_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MercadoLibreProviderError("PROVIDER_INVALID_RESPONSE");
    return record(parsed);
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Capability-gated official API adapter. No scraping, redirects, refresh or hidden retries. */
export async function searchMercadoLibreComparables(query: MarketQuery, options: { config?: MercadoLibreConfig; fetcher?: typeof fetch; now?: Date; timeoutMs?: number } = {}): Promise<MarketBatch> {
  const config = options.config ?? mercadoLibreConfiguration();
  if (!mercadoLibreConfigured(config)) throw new MercadoLibreProviderError("NOT_CONFIGURED");
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const controller = new AbortController();
  const timeoutMs = Math.min(MERCADOLIBRE_LIMITS.timeoutMs, Math.max(1, options.timeoutMs ?? MERCADOLIBRE_LIMITS.timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new MercadoLibreProviderError("PROVIDER_TIMEOUT")); }, timeoutMs); });
  const work = async (): Promise<MarketBatch> => {
    const comparables: MarketComparable[] = [];
    let discardedCount = 0;
    let total: number | undefined;
    for (let page = 0; page < MERCADOLIBRE_LIMITS.maxPages; page += 1) {
      controller.signal.throwIfAborted();
      const url = new URL("https://api.mercadolibre.com/sites/MLA/search");
      url.searchParams.set("q", `${query.make} ${query.model} ${query.trim} ${query.year}`);
      url.searchParams.set("category", "MLA1744");
      url.searchParams.set("limit", String(MERCADOLIBRE_LIMITS.pageSize));
      url.searchParams.set("offset", String(page * MERCADOLIBRE_LIMITS.pageSize));
      const response = await (options.fetcher ?? fetch)(url, { headers: { Authorization: `Bearer ${config.accessToken}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal });
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new MercadoLibreProviderError(response.status === 401 || response.status === 403 ? "PROVIDER_ACCESS_DENIED" : response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE");
      }
      const payload = await boundedJson(response, controller.signal);
      const paging = record(payload.paging);
      if (!Array.isArray(payload.results) || payload.results.length > MERCADOLIBRE_LIMITS.pageSize || !Number.isSafeInteger(paging.total) || Number(paging.total) < 0 || paging.offset !== page * MERCADOLIBRE_LIMITS.pageSize || paging.limit !== MERCADOLIBRE_LIMITS.pageSize) throw new MercadoLibreProviderError("PROVIDER_INVALID_RESPONSE");
      if (total !== undefined && total !== paging.total) throw new MercadoLibreProviderError("PROVIDER_RESULTS_CHANGED");
      total = Number(paging.total);
      const expected = Math.min(MERCADOLIBRE_LIMITS.pageSize, Math.max(0, total - page * MERCADOLIBRE_LIMITS.pageSize));
      if (payload.results.length !== expected) throw new MercadoLibreProviderError("PROVIDER_PARTIAL_RESPONSE");
      for (const item of payload.results) { const comparable = normalizeMercadoLibreItem(item, fetchedAt); if (comparable) comparables.push(comparable); else discardedCount += 1; }
      if ((page + 1) * MERCADOLIBRE_LIMITS.pageSize >= total) return { source: "MERCADOLIBRE", fetchedAt, complete: true, comparables, discardedCount };
    }
    return { source: "MERCADOLIBRE", fetchedAt, complete: false, comparables, discardedCount };
  };
  try { return await Promise.race([work(), timeout]); }
  catch (error) { if (error instanceof MercadoLibreProviderError) throw error; throw new MercadoLibreProviderError(controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_INVALID_RESPONSE"); }
  finally { clearTimeout(timer); controller.abort(); }
}
