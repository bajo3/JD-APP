import { adminConsignmentPhotoBytes } from "@/lib/server/consignment-media";

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id, mediaId } = await context.params;
  return adminConsignmentPhotoBytes(request, id, mediaId);
}
