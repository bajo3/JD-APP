import { accountPasswordResponse } from "@/lib/server/account-api";

export const PUT = (request: Request) => accountPasswordResponse(request);
