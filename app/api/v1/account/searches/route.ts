import { accountSearchesResponse } from "@/lib/server/account-api";

export const GET = (request: Request) => accountSearchesResponse(request);
export const POST = (request: Request) => accountSearchesResponse(request);
