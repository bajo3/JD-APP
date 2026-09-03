import { adminConversationReply } from "@/lib/server/admin-handlers";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  return adminConversationReply(request, (await context.params).id);
}
