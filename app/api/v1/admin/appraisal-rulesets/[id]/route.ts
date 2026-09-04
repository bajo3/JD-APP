import { adminAppraisalRuleSet } from "@/lib/server/admin-handlers";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return adminAppraisalRuleSet(request, (await context.params).id);
}
