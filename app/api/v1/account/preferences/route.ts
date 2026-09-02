import { accountPreferencesResponse } from "@/lib/server/account-api";

export const GET = (request: Request) => accountPreferencesResponse(request);
export const PUT = (request: Request) => accountPreferencesResponse(request);
