import { createSimulationResponse } from "@/lib/server/simulation-api";
import { withRateLimit } from "@/lib/server/rate-limit";

export const POST = withRateLimit(
  "public.simulation",
  (request) => createSimulationResponse(request),
);
