import { adminConversationWorkflow } from "@/lib/server/admin-handlers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return adminConversationWorkflow(request, (await context.params).id);
}
