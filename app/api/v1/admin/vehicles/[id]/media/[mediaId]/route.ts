import { adminVehicleMediaItem } from "@/lib/server/vehicle-media";

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const params = await context.params;
  return adminVehicleMediaItem(request, params.id, params.mediaId);
}
