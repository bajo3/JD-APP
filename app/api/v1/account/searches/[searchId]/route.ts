import { accountSearchItemResponse } from "@/lib/server/account-api";

type Context = { params: Promise<{ searchId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return accountSearchItemResponse(request, (await context.params).searchId);
}
