import { registerAccountResponse } from "@/lib/server/account-api";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit("public.account-register", (request) =>
  registerAccountResponse(request),
);
