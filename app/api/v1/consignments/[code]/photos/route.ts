import { publicConsignmentPhotoUpload } from "@/lib/server/consignment-media";
import { withRateLimit } from "@/lib/server/rate-limit";

type Context = { params: Promise<{ code: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const code = (await context.params).code;
  return withRateLimit("public.consignment-photo", () =>
    publicConsignmentPhotoUpload(request, code),
  )(request);
}
