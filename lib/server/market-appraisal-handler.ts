import { MarketAppraisalError } from "@/lib/domain/market-appraisal.mjs";
import { runMarketAppraisal } from "./market-appraisal";
import { adminApiRoute, adminData } from "./admin-api";
import type { AdminAuthOptions } from "./admin-auth";
import { ApiError, readJsonObject } from "./api";
import { enforceRateLimit, type RateLimitRuntime } from "./rate-limit";

type MarketAppraisalRuntime = Readonly<{
  auth?: AdminAuthOptions;
  rateLimit?: RateLimitRuntime;
  run?: typeof runMarketAppraisal;
}>;

/**
 * Consulta administrativa de sólo lectura. La autorización corre antes de
 * consumir cupo o contactar al proveedor; no persiste ni promueve tarifarios.
 */
export function adminMarketAppraisals(
  request: Request,
  runtime: MarketAppraisalRuntime = {},
): Promise<Response> {
  return adminApiRoute(request, async () => {
    await enforceRateLimit(request, "public.appraisal", runtime.rateLimit);
    const payload = await readJsonObject(request);
    try {
      return adminData(await (runtime.run ?? runMarketAppraisal)(payload));
    } catch (error) {
      if (error instanceof MarketAppraisalError) {
        throw new ApiError(422, error.code, error.message);
      }
      throw error;
    }
  }, runtime.auth);
}
