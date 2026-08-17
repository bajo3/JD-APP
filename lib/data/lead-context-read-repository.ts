import { and, desc, eq } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import {
  leadEvents,
  leadInterests,
  leads,
  simulations,
  vehicles,
  type LeadRow,
  type SimulationRow,
  type VehicleRow,
} from "@/db/schema";

export type LeadEventRecord = Readonly<{
  id: string;
  type: string;
  actorType: string;
  metadataJson: string;
  occurredAt: string;
}>;

export type LeadContextDetailRecord = Readonly<{
  lead: LeadRow;
  simulation: SimulationRow | null;
  vehicle: VehicleRow | null;
  events: LeadEventRecord[];
}>;

export class D1LeadContextReadRepository {
  constructor(private readonly db: Database = getDb()) {}

  async findById(id: string): Promise<LeadContextDetailRecord | null> {
    const [lead] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) return null;
    const [operation] = await this.db
      .select({ simulation: simulations, vehicle: vehicles })
      .from(leadInterests)
      .innerJoin(simulations, eq(simulations.id, leadInterests.simulationId))
      .innerJoin(vehicles, eq(vehicles.id, simulations.vehicleId))
      .where(
        and(
          eq(leadInterests.leadId, id),
          eq(leadInterests.kind, "SIMULATION"),
          eq(simulations.leadId, id),
          eq(leadInterests.vehicleId, simulations.vehicleId),
        ),
      )
      .limit(1);
    const events = await this.db
      .select({
        id: leadEvents.id,
        type: leadEvents.type,
        actorType: leadEvents.actorType,
        metadataJson: leadEvents.metadataJson,
        occurredAt: leadEvents.occurredAt,
      })
      .from(leadEvents)
      .where(eq(leadEvents.leadId, id))
      .orderBy(desc(leadEvents.occurredAt));
    return Object.freeze({
      lead,
      simulation: operation?.simulation ?? null,
      vehicle: operation?.vehicle ?? null,
      events,
    });
  }
}
