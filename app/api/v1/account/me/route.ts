import { accountProfileResponse } from "@/lib/server/account-api";

export const GET = (request: Request) => accountProfileResponse(request);
export const PATCH = (request: Request) => accountProfileResponse(request);
