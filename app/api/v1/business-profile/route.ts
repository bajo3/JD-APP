import { ApiError, apiRoute, json } from "@/lib/server/api";
import { getDataAccess, sourceMeta } from "@/lib/server/data-access";
import { businessProfileDto } from "@/lib/server/dto";

export async function GET(): Promise<Response> {
  return apiRoute(async () => {
    const access = getDataAccess();
    const profile = await access.businessProfile.get();
    if (!profile) {
      throw new ApiError(404, "BUSINESS_PROFILE_NOT_FOUND", "El perfil del negocio no está configurado.");
    }
    return json({ data: businessProfileDto(profile), meta: sourceMeta(access.source) });
  });
}
