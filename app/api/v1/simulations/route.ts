import { createSimulationResponse } from "@/lib/server/simulation-api";

export async function POST(request: Request): Promise<Response> {
  return createSimulationResponse(request);
}
