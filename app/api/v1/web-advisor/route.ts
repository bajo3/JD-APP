import { withRateLimit } from "@/lib/server/rate-limit";
import { handleWebAdvisor } from "@/lib/server/web-advisor";

export const POST = withRateLimit("public.web-advisor", (request) => handleWebAdvisor(request));
