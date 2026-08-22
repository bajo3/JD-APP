import { createWhatsappHandoffResponse } from "@/lib/server/whatsapp-handoff";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit(
  "public.handoff",
  (request) => createWhatsappHandoffResponse(request),
);
