import { adminZernioStatus } from "@/lib/server/zernio-admin";

export function GET(request: Request): Promise<Response> {
  return adminZernioStatus(request);
}
