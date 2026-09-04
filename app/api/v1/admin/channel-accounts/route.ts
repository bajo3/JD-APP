import { adminChannelAccounts } from "@/lib/server/admin-handlers";

export function GET(request: Request): Promise<Response> {
  return adminChannelAccounts(request);
}

export function POST(request: Request): Promise<Response> {
  return adminChannelAccounts(request);
}
