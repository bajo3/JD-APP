import { adminMarketAppraisals } from "@/lib/server/market-appraisal-handler";

export async function POST(request: Request): Promise<Response> {
  return adminMarketAppraisals(request);
}
