import { createConsignmentIntake } from "@/lib/server/consignment-intake";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit(
  "public.consignment",
  (request) => createConsignmentIntake(request),
);
