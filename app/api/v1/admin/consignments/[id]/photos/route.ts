import { adminConsignmentPhotoList } from "@/lib/server/consignment-media";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return adminConsignmentPhotoList(request, (await context.params).id);
}
