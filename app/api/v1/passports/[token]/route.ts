import { ApiError, apiRoute, json, readJsonObject } from "@/lib/server/api";
import { confirmPublicPassportReview, findPublicPassportReview } from "@/lib/server/passport-review";
import { withRateLimit } from "@/lib/server/rate-limit";

async function getReview(_request: Request, token: string): Promise<Response> {
  return apiRoute(async () => {
    const review = await findPublicPassportReview(token);
    if (!review) throw new ApiError(404, "PASSPORT_NOT_FOUND", "No encontramos esta búsqueda.");
    return json({ data: review });
  });
}

async function confirmReview(request: Request, token: string): Promise<Response> {
  return apiRoute(async () => {
    const result = await confirmPublicPassportReview(token, await readJsonObject(request));
    if (result === "not_found") throw new ApiError(404, "PASSPORT_NOT_FOUND", "No encontramos esta búsqueda.");
    if (result === "conflict") throw new ApiError(409, "PASSPORT_CHANGED", "La búsqueda cambió. Actualizá la página antes de confirmar.");
    if (result === "already_confirmed") return json({ data: { status: "CONFIRMED", replayed: true } });
    return json({ data: { status: "CONFIRMED", replayed: false } }, { status: 201 });
  });
}

const limitedGet = withRateLimit("public.passport-review", getReview);
const limitedConfirm = withRateLimit("public.passport-review", confirmReview);

export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  return limitedGet(request, (await context.params).token);
}

export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  return limitedConfirm(request, (await context.params).token);
}
