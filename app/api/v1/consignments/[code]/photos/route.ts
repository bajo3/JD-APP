import { publicConsignmentPhotoUpload } from "@/lib/server/consignment-media";

type Context = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  return publicConsignmentPhotoUpload(request, (await context.params).code);
}
