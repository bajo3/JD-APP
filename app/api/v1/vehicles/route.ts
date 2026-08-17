import { ApiError, apiRoute, json } from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { vehicleDto } from "@/lib/server/dto";

function queryInteger(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ApiError(400, "INVALID_QUERY", "Los filtros de búsqueda no son válidos.");
  }
  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  return apiRoute(async () => {
    const url = new URL(request.url);
    const access = getDataAccess();
    const [vehicles, profile] = await Promise.all([
      access.stock.listAvailable(),
      access.businessProfile.get(),
    ]);
    const normalized = (value: string | null) => value?.trim().toLocaleLowerCase("es") ?? null;
    const make = normalized(url.searchParams.get("make"));
    const bodyType = normalized(url.searchParams.get("bodyType"));
    const transmission = normalized(url.searchParams.get("transmission"));
    const fuelType = normalized(url.searchParams.get("fuelType"));
    const maxPrice = url.searchParams.get("maxPriceCents");
    const maxPriceCents = maxPrice === null ? null : Number(maxPrice);
    if (maxPriceCents !== null && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)) {
      throw new ApiError(400, "INVALID_QUERY", "Los filtros de búsqueda no son válidos.");
    }
    const limit = queryInteger(url.searchParams.get("limit"), 24, 50);
    const cursor = url.searchParams.get("cursor");
    const sort = url.searchParams.get("sort") ?? "updated_desc";
    if (!new Set(["updated_desc", "price_asc", "price_desc"]).has(sort)) {
      throw new ApiError(400, "INVALID_QUERY", "El orden solicitado no es válido.");
    }

    const filtered = vehicles.filter(
      (vehicle) =>
        (!make || vehicle.make.toLocaleLowerCase("es") === make) &&
        (!bodyType || vehicle.bodyType.toLocaleLowerCase("es") === bodyType) &&
        (!transmission || vehicle.transmission.toLocaleLowerCase("es") === transmission) &&
        (!fuelType || vehicle.fuelType.toLocaleLowerCase("es") === fuelType) &&
        (maxPriceCents === null || vehicle.priceCents <= maxPriceCents),
    );
    filtered.sort((left, right) => {
      if (sort === "price_asc") return left.priceCents - right.priceCents;
      if (sort === "price_desc") return right.priceCents - left.priceCents;
      return right.updatedAt.localeCompare(left.updatedAt) || left.slug.localeCompare(right.slug);
    });

    const cursorIndex = cursor ? filtered.findIndex((vehicle) => vehicle.slug === cursor) : -1;
    if (cursor && cursorIndex < 0) {
      throw new ApiError(400, "INVALID_CURSOR", "El cursor ya no es válido.");
    }
    const page = filtered.slice(cursorIndex + 1, cursorIndex + 1 + limit);
    const hasMore = cursorIndex + 1 + page.length < filtered.length;
    const freshnessMinutes = profile?.stockFreshnessMinutes ?? 1440;

    return json({
      data: page.map((vehicle) => vehicleDto(vehicle, freshnessMinutes)),
      meta: {
        ...sourceMeta(access.source),
        count: page.length,
        hasMore,
        nextCursor: hasMore ? page.at(-1)?.slug ?? null : null,
      },
    });
  });
}
