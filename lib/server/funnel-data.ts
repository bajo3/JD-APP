import { and, count, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { inboxConversations, leadEvents, leadInterests, leads, simulations, vehicles } from "@/db/schema";
import { buildConversionFunnel, conversionRate } from "@/lib/analytics/funnel.mjs";

const WINDOW_DAYS = 30;
const CONTACTED_STATUSES = ["CONTACTED", "QUALIFIED", "WON"] as const;

export type FunnelBreakdownRow = Readonly<{
  label: string;
  leads: number;
  contacted: number;
  won: number;
  contactRate: number | null;
  winRate: number | null;
}>;

export type ConversionFunnel = ReturnType<typeof buildConversionFunnel> & Readonly<{
  breakdowns: Readonly<{
    channels: readonly FunnelBreakdownRow[];
    vehicles: readonly FunnelBreakdownRow[];
    sellers: readonly FunnelBreakdownRow[];
  }>;
}>;

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
  const untilIso = until.toISOString();

  const [simulationRows, linkedRows, handoffRows, contactedRows, wonRows, channelRows, vehicleRows, sellerRows] = await Promise.all([
    db.select({ total: count() }).from(simulations).where(and(gte(simulations.createdAt, sinceIso), lt(simulations.createdAt, untilIso))),
    db
      .select({ total: sql<number>`count(distinct ${leadInterests.leadId})` })
      .from(leadInterests)
      .where(and(eq(leadInterests.kind, "SIMULATION"), gte(leadInterests.createdAt, sinceIso), lt(leadInterests.createdAt, untilIso))),
    db
      .select({ total: sql<number>`count(distinct ${leadEvents.leadId})` })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.type, "WHATSAPP_HANDOFF_CREATED"),
          gte(leadEvents.occurredAt, sinceIso),
          lt(leadEvents.occurredAt, untilIso),
        ),
      ),
    db
      .select({ total: sql<number>`count(distinct ${leadEvents.leadId})` })
      .from(leadEvents)
      .where(and(
        eq(leadEvents.type, "STATUS_CHANGED"),
        sql`(${leadEvents.metadataJson}::jsonb ->> 'to') in (${sql.join(CONTACTED_STATUSES.map((status) => sql`${status}`), sql`, `)})`,
        gte(leadEvents.occurredAt, sinceIso),
        lt(leadEvents.occurredAt, untilIso),
      )),
    db
      .select({ total: sql<number>`count(distinct ${leadEvents.leadId})` })
      .from(leadEvents)
      .where(and(
        eq(leadEvents.type, "STATUS_CHANGED"),
        sql`(${leadEvents.metadataJson}::jsonb ->> 'to') = 'WON'`,
        gte(leadEvents.occurredAt, sinceIso),
        lt(leadEvents.occurredAt, untilIso),
      )),
    breakdownQuery(db, channelDimension(), sinceIso, untilIso),
    breakdownQuery(db, vehicleDimension(), sinceIso, untilIso),
    breakdownQuery(db, sellerDimension(), sinceIso, untilIso),
  ]);

  const total = (rows: readonly { total: number | null }[]) => Number(rows[0]?.total ?? 0);

  const funnel = buildConversionFunnel(
    {
      simulations: total(simulationRows),
      linkedLeads: total(linkedRows),
      handoffs: total(handoffRows),
      contacted: total(contactedRows),
      won: total(wonRows),
    },
    { since: sinceIso, until: untilIso },
  );
  return Object.freeze({
    ...funnel,
    breakdowns: Object.freeze({
      channels: breakdownRows(channelRows),
      vehicles: breakdownRows(vehicleRows),
      sellers: breakdownRows(sellerRows),
    }),
  });
}

type RawBreakdownRow = { label: string | null; leads: number | null; contacted: number | null; won: number | null };

// Drizzle shortens an outer-column reference to `"id"` when it is embedded in
// a correlated subquery inside the select list. The explicit qualifier keeps
// that reference unambiguous when the subquery joins another table with `id`.
const outerLeadId = sql.raw('"lead"."id"');

function channelDimension() {
  return sql<string>`coalesce(
    (select lower(c.platform) from ${inboxConversations} c
      where c.lead_id = ${outerLeadId}
      order by c.updated_at desc, c.id asc limit 1),
    nullif(${leads.source}, ''), 'Sin canal')`;
}

function vehicleDimension() {
  return sql<string>`coalesce(
    (select trim(v.make || ' ' || v.model || ' ' || coalesce(v.trim, '') || ' ' || v.year::text)
       from ${leadInterests} li
       join ${vehicles} v on v.id = li.vehicle_id
      where li.lead_id = ${outerLeadId} and li.vehicle_id is not null
      order by li.created_at asc, li.id asc limit 1),
    'Sin vehículo')`;
}

function sellerDimension() {
  return sql<string>`coalesce(nullif(${leads.assignedTo}, ''), 'Sin asignar')`;
}

function breakdownQuery(
  db: Database,
  dimension: SQL<string>,
  sinceIso: string,
  untilIso: string,
) {
  const contacted = sql<number>`sum(case when exists (
    select 1 from ${leadEvents} e
     where e.lead_id = ${outerLeadId}
       and e.type = 'STATUS_CHANGED'
       and (e.metadata_json::jsonb ->> 'to') in ('CONTACTED', 'QUALIFIED', 'WON')
       and e.occurred_at < ${untilIso}
  ) then 1 else 0 end)`;
  const won = sql<number>`sum(case when exists (
    select 1 from ${leadEvents} e
     where e.lead_id = ${outerLeadId}
       and e.type = 'STATUS_CHANGED'
       and (e.metadata_json::jsonb ->> 'to') = 'WON'
       and e.occurred_at < ${untilIso}
  ) then 1 else 0 end)`;
  return db
    .select({
      label: dimension,
      leads: sql<number>`count(*)`,
      contacted,
      won,
    })
    .from(leads)
    .where(and(gte(leads.createdAt, sinceIso), lt(leads.createdAt, untilIso)))
    .groupBy(dimension)
    .orderBy(sql`count(*) desc`, dimension);
}

function breakdownRows(rows: readonly RawBreakdownRow[]): readonly FunnelBreakdownRow[] {
  return Object.freeze(rows.map((row) => {
    const leadsCount = Number(row.leads ?? 0);
    const contactedCount = Number(row.contacted ?? 0);
    const wonCount = Number(row.won ?? 0);
    return Object.freeze({
      label: row.label?.trim() || "Sin dato",
      leads: leadsCount,
      contacted: contactedCount,
      won: wonCount,
      contactRate: conversionRate(contactedCount, leadsCount),
      winRate: conversionRate(wonCount, leadsCount),
    });
  }));
}
