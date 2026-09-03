import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { demandMatches, demands, leads, vehicles } from "@/db/schema";
import { buildDemandMap } from "@/lib/analytics/demand-map.mjs";
import { FULL_MATCH_BPS } from "@/lib/domain/demand-matching.mjs";
import { buildMatchMessageDraft } from "./demand-matching-service";
import { requirePanelUser } from "./panel-auth";

export type PendingMatch = Readonly<{
  matchId: string;
  demandCode: string;
  buyer: string;
  assignedTo: string | null;
  vehicle: string;
  scorePercent: number;
  cumple: readonly string[];
  noCumple: readonly string[];
  draft: string;
}>;

export type OpenDemand = Readonly<{
  id: string;
  code: string;
  buyer: string;
  assignedTo: string | null;
  validUntil: string;
  resumen: string;
}>;

type Runtime = Readonly<{ db?: Database; now?: Date }>;

function criteriaSummary(criteria: Record<string, unknown>): string {
  const parts: string[] = [];
  const makes = Array.isArray(criteria.makes) ? criteria.makes : [];
  const models = Array.isArray(criteria.models) ? criteria.models : [];
  const buscado = [...models, ...makes].slice(0, 3).join(" / ");
  if (buscado) parts.push(buscado);
  if (typeof criteria.minYear === "number") parts.push(`desde ${criteria.minYear}`);
  if (typeof criteria.maxPriceCents === "number") {
    const currency = String(criteria.currency ?? "ARS");
    parts.push(`hasta ${currency} ${Math.round(criteria.maxPriceCents / 100).toLocaleString("es-AR")}`);
  }
  if (criteria.tradeIn === true) parts.push("entrega un usado");
  if (typeof criteria.urgencyDays === "number") parts.push(`compra en ${criteria.urgencyDays} días`);
  // Una demanda sin criterios legibles se dice, no se rellena con supuestos.
  return parts.length > 0 ? parts.join(" · ") : "sin criterios declarados";
}

/**
 * Datos del tablero de demanda. Todo sale de filas persistidas: el tablero no
 * estima ni proyecta, y lo que nadie declaró aparece como no declarado.
 */
export async function getDemandPanelData(runtime: Runtime = {}) {
  await requirePanelUser();
  const db = runtime.db ?? getDb();
  const now = runtime.now ?? new Date();
  const nowIso = now.toISOString();

  const [demandRows, matchRows] = await Promise.all([
    db
      .select({
        id: demands.id,
        code: demands.publicCode,
        status: demands.status,
        criteriaJson: demands.criteriaJson,
        validUntil: demands.validUntil,
        assignedTo: demands.assignedTo,
        buyer: leads.name,
      })
      .from(demands)
      .innerJoin(leads, eq(leads.id, demands.leadId))
      .where(and(eq(demands.status, "OPEN"), gt(demands.validUntil, nowIso)))
      .orderBy(desc(demands.createdAt)),
    db
      .select({
        matchId: demandMatches.id,
        scoreBps: demandMatches.scoreBps,
        breakdownJson: demandMatches.breakdownJson,
        demandCode: demands.publicCode,
        assignedTo: demands.assignedTo,
        buyer: leads.name,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
      })
      .from(demandMatches)
      .innerJoin(demands, eq(demands.id, demandMatches.demandId))
      .innerJoin(leads, eq(leads.id, demands.leadId))
      .innerJoin(vehicles, eq(vehicles.id, demandMatches.vehicleId))
      .where(eq(demandMatches.status, "NEW"))
      .orderBy(desc(demandMatches.scoreBps)),
  ]);

  const parsed = demandRows.map((row) => {
    let criteria: Record<string, unknown> = {};
    try {
      criteria = JSON.parse(row.criteriaJson) as Record<string, unknown>;
    } catch {
      criteria = {};
    }
    return { ...row, criteria };
  });

  const openDemands: OpenDemand[] = parsed.map((row) => ({
    id: row.id,
    code: row.code,
    buyer: row.buyer,
    assignedTo: row.assignedTo,
    validUntil: row.validUntil,
    resumen: criteriaSummary(row.criteria),
  }));

  const pending: PendingMatch[] = matchRows.map((row) => {
    let criterios: Array<{ criterio: string; cumple: boolean; detalle: string }> = [];
    try {
      const parsedBreakdown = JSON.parse(row.breakdownJson) as { criterios?: unknown };
      if (Array.isArray(parsedBreakdown.criterios)) {
        criterios = parsedBreakdown.criterios as typeof criterios;
      }
    } catch {
      criterios = [];
    }
    return {
      matchId: row.matchId,
      demandCode: row.demandCode,
      buyer: row.buyer,
      assignedTo: row.assignedTo,
      vehicle: `${row.make} ${row.model} ${row.year}`,
      scorePercent: Math.round((row.scoreBps / FULL_MATCH_BPS) * 100),
      cumple: criterios.filter((item) => item.cumple).map((item) => item.criterio),
      noCumple: criterios.filter((item) => !item.cumple).map((item) => item.detalle),
      draft: buildMatchMessageDraft({
        vehicle: {
          id: "",
          make: row.make,
          model: row.model,
          year: row.year,
          priceCents: null,
          currency: "ARS",
          mileageKm: null,
        },
        demandCode: row.demandCode,
      }),
    };
  });

  return {
    map: buildDemandMap(
      parsed.map((row) => ({
        id: row.id,
        criteria: row.criteria,
        status: row.status,
        validUntil: row.validUntil,
      })),
      { now },
    ),
    openDemands,
    pending,
  };
}
