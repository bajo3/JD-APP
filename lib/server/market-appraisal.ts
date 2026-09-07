import "server-only";
import { estimateMarketAppraisal, marketNoEstimate, normalizeMarketAppraisalQuery } from "../domain/market-appraisal.mjs";
import { MercadoLibreProviderError, mercadoLibreConfiguration, mercadoLibreConfigured, searchMercadoLibreComparables, type MarketQuery, type MercadoLibreConfig } from "./mercadolibre-provider";

/** Call only after panel authorization and durable abuse limiting. Read-only; no DB or ruleset writes. */
export async function runMarketAppraisal(input: unknown, options: { config?: MercadoLibreConfig; fetcher?: typeof fetch; now?: Date; timeoutMs?: number } = {}) {
  const now = options.now ?? new Date();
  const query = normalizeMarketAppraisalQuery(input, now) as MarketQuery;
  const config = options.config ?? mercadoLibreConfiguration();
  if (!mercadoLibreConfigured(config)) return marketNoEstimate("NOT_CONFIGURED", "SOURCE_NOT_AUTHORIZED_OR_CONFIGURED");
  try {
    const batch = await searchMercadoLibreComparables(query, { ...options, config, now });
    // No raw provider object is ever returned, even on errors.
    const result = estimateMarketAppraisal(query, batch, now);
    if (result.status !== "READY_FOR_REVIEW" || !("sourceItemIds" in result)) return result;
    const included = new Set(result.sourceItemIds);
    return {
      ...result,
      comparables: batch.comparables.filter(
        (item) => included.has(item.sourceItemId) && item.priceKind === "ASKING_TOTAL",
      ),
    };
  } catch (error) {
    return marketNoEstimate("PROVIDER_UNAVAILABLE", error instanceof MercadoLibreProviderError ? error.code : "PROVIDER_UNAVAILABLE");
  }
}
