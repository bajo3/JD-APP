import { adminAppraisalPhotoBytes } from "@/lib/server/appraisal-media";

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id, mediaId } = await context.params;
  return adminAppraisalPhotoBytes(request, id, mediaId);
}
