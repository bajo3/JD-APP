import { ApiError, apiRoute, json } from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { simulationDto } from "@/lib/server/dto";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<Response> {
  return apiRoute(async () => {
    const { code } = await context.params;
    if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) {
      throw new ApiError(400, "INVALID_SIMULATION_CODE", "El código de simulación no es válido.");
    }
    const access = getDataAccess();
    const simulation = await access.simulations.findByPublicCode(code.toUpperCase());
    if (!simulation) {
      throw new ApiError(404, "SIMULATION_NOT_FOUND", "No encontramos la simulación.");
    }
    const expired = Date.parse(simulation.expiresAt) <= Date.now();
    return json({
      data: { ...simulationDto(simulation), expired },
      meta: sourceMeta(access.source),
    });
  });
}
