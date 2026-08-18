import { publicAppraisalPhotoUpload } from "@/lib/server/appraisal-media";

type Context = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  return publicAppraisalPhotoUpload(request, (await context.params).code);
}
