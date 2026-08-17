import { ApiError, apiRoute, json } from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { vehicleDto } from "@/lib/server/dto";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return apiRoute(async () => {
    const { slug } = await context.params;
    if (!/^[a-z0-9-]{3,120}$/.test(slug)) {
      throw new ApiError(400, "INVALID_SLUG", "El identificador del vehículo no es válido.");
    }
    const access = getDataAccess();
    const [vehicle, profile] = await Promise.all([
      access.stock.findBySlug(slug),
      access.businessProfile.get(),
    ]);
    if (!vehicle) {
      throw new ApiError(404, "VEHICLE_NOT_FOUND", "El vehículo no está disponible.");
    }
    return json({
      data: vehicleDto(vehicle, profile?.stockFreshnessMinutes ?? 1440),
      meta: sourceMeta(access.source),
    });
  });
}
