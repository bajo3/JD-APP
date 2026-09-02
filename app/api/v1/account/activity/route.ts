import { accountActivityResponse } from "@/lib/server/account-api";

export const GET = (request: Request) => accountActivityResponse(request);
