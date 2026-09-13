import { adminZernioSync } from "@/lib/server/zernio-admin";

export function POST(request: Request): Promise<Response> {
  return adminZernioSync(request);
}
