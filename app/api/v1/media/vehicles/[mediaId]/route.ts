import { publicVehicleMedia } from "@/lib/server/vehicle-media";

type Context = { params: Promise<{ mediaId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return publicVehicleMedia(request, (await context.params).mediaId);
}
