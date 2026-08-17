import { adminVehicleMediaCollection } from "@/lib/server/vehicle-media";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return adminVehicleMediaCollection(request, (await context.params).id);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return adminVehicleMediaCollection(request, (await context.params).id);
}
