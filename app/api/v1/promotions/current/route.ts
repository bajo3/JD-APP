import { apiRoute, json } from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { promotionDto } from "@/lib/server/dto";

export async function GET(): Promise<Response> {
  return apiRoute(async () => {
    const now = new Date();
    const access = getDataAccess();
    const promotion = await access.promotions.findCurrent(now);
    return json({
      data: promotion ? promotionDto(promotion, now) : null,
      meta: { ...sourceMeta(access.source), serverNow: now.toISOString() },
    });
  });
}
