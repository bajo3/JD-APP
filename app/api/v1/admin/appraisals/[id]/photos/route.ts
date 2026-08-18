import { adminAppraisalPhotoList } from "@/lib/server/appraisal-media";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return adminAppraisalPhotoList(request, (await context.params).id);
}
