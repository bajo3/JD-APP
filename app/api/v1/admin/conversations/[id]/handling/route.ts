import { adminConversationHandling } from "@/lib/server/admin-handlers";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  return adminConversationHandling(request, (await context.params).id);
}
