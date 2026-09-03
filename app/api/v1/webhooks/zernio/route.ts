import { handleZernioWebhook } from "@/lib/server/zernio-webhook";

export async function POST(request: Request): Promise<Response> {
  return handleZernioWebhook(request);
}
