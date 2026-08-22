import { createLeadResponse } from "@/lib/server/lead-conversion";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit("public.lead", (request) => createLeadResponse(request));
