import { searchAffordability } from "@/lib/application/index.mjs";
import { apiRoute, json, readJsonObject } from "@/lib/server/api";
import {
  applicationDependencies,
  rethrowApplicationError,
} from "@/lib/server/affordability";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";

export async function POST(request: Request): Promise<Response> {
  return apiRoute(async () => {
    const payload = await readJsonObject(request);
    const now = new Date();
    const access = getDataAccess();
    const dependencies = await applicationDependencies(access, now);
    try {
      const data = await searchAffordability(
        { ...payload, evaluatedAt: now.toISOString() },
        dependencies,
      );
      return json({ data, meta: { ...sourceMeta(access.source), serverNow: now.toISOString() } });
    } catch (error) {
      rethrowApplicationError(error);
    }
  });
}
