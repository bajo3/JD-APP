import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { leadEvents, leadInterests, leads, simulations } from "@/db/schema";
import { buildConversionFunnel } from "@/lib/analytics/funnel.mjs";

const WINDOW_DAYS = 30;
const CONTACTED_STATUSES = ["CONTACTED", "QUALIFIED", "WON"] as const;

export type ConversionFunnel = ReturnType<typeof buildConversionFunnel>;

type FunnelRuntime = Readonly<{
  db?: Database;
  now?: Date;
  windowDays?: number;
}>;

// Every number comes from a row that already exists: no sampling, no
// estimation and no client-side beacon.
export async function getConversionFunnel(runtime: FunnelRuntime = {}): Promise<ConversionFunnel> {
  const db = runtime.db ?? getDb();
  const until = runtime.now ?? new Date();
  const since = new Date(until.getTime() - (runtime.windowDays ?? WINDOW_DAYS) * 86_400_000);
  const sinceIso = since.toISOString();

  const [simulationRows, linkedRows, handoffRows, contactedRows, wonRows] = await Promise.all([
    db.select({ total: count() }).from(simulations).where(gte(simulations.createdAt, sinceIso)),
    db
      .select({ total: sql<number>`count(distinct ${leadInterests.leadId})` })
      .from(leadInterests)
      .innerJoin(leads, eq(leads.id, leadInterests.leadId))
      .where(and(eq(leadInterests.kind, "SIMULATION"), gte(leads.createdAt, sinceIso))),
    db
      .select({ total: sql<number>`count(distinct ${leadEvents.leadId})` })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.type, "WHATSAPP_HANDOFF_CREATED"),
          gte(leadEvents.occurredAt, sinceIso),
        ),
      ),
    db
      .select({ total: count() })
      .from(leads)
      .where(and(inArray(leads.status, [...CONTACTED_STATUSES]), gte(leads.createdAt, sinceIso))),
    db
      .select({ total: count() })
      .from(leads)
      .where(and(eq(leads.status, "WON"), gte(leads.createdAt, sinceIso))),
  ]);

  const total = (rows: readonly { total: number | null }[]) => Number(rows[0]?.total ?? 0);

  return buildConversionFunnel(
    {
      simulations: total(simulationRows),
      linkedLeads: total(linkedRows),
      handoffs: total(handoffRows),
      contacted: total(contactedRows),
      won: total(wonRows),
    },
    { since: sinceIso, until: until.toISOString() },
  );
}
