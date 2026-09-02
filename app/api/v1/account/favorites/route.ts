import { accountFavoritesResponse } from "@/lib/server/account-api";

export const GET = (request: Request) => accountFavoritesResponse(request);
export const POST = (request: Request) => accountFavoritesResponse(request);
