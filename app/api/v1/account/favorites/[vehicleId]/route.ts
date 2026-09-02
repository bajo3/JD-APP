import { accountFavoriteItemResponse } from "@/lib/server/account-api";

type Context = { params: Promise<{ vehicleId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return accountFavoriteItemResponse(request, (await context.params).vehicleId);
}
