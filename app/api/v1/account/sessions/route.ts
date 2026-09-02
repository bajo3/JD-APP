import { loginResponse, logoutResponse } from "@/lib/server/account-api";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit("public.account-login", (request) => loginResponse(request));
export const DELETE = (request: Request) => logoutResponse(request);
