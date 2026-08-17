import { adminAppraisal } from "@/lib/server/admin-handlers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return adminAppraisal(request, (await context.params).id);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return adminAppraisal(request, (await context.params).id);
}

