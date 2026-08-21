import { createConsignmentIntake } from "@/lib/server/consignment-intake";

export async function POST(request: Request): Promise<Response> {
  return createConsignmentIntake(request);
}
