import { adminZernioAdvisor, adminZernioStatus } from "@/lib/server/zernio-admin";

export function GET(request: Request): Promise<Response> {
  return adminZernioStatus(request);
}

export function PATCH(request: Request): Promise<Response> {
  return adminZernioAdvisor(request);
}
