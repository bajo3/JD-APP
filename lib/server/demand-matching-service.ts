import {
  matchVehicleToDemand,
  normalizeDemandCriteria,
  FULL_MATCH_BPS,
} from "@/lib/domain/demand-matching.mjs";
import {
  D1DemandRepository,
  type DemandRecord,
  type DemandRepositoryLike,
} from "@/lib/data/demand-repository";

/** Coincidencia mínima para molestar a un vendedor. Explícito, no implícito. */
export const NOTIFY_THRESHOLD_BPS = 6_000;

export type MatchedVehicle = Readonly<{
  id: string;
  make: string;
  model: string;
  year: number;
  priceCents: number | null;
  currency: string;
  mileageKm: number | null;
}>;

export type DemandMatchView = Readonly<{
  demandId: string;
  demandCode: string;
  leadId: string;
  assignedTo: string | null;
  scoreBps: number;
  scorePercent: number;
  breakdown: readonly Readonly<{ criterio: string; peso: number; cumple: boolean; detalle: string }>[];
  draft: string;
}>;

export type DemandMatchingRuntime = Readonly<{
  repository?: DemandRepositoryLike;
  now?: Date;
  newId?: () => string;
  notifyThresholdBps?: number;
}>;

function percent(scoreBps: number): number {
  return Math.round((scoreBps / FULL_MATCH_BPS) * 100);
}

/**
 * Mensaje preparado para el comprador. **Es un borrador**: no se manda solo.
 * Cita únicamente lo que el sistema sabe de la unidad —marca, modelo, año— y
 * no incluye precio ni cuota: eso lo confirma el vendedor con una simulación,
 * que es la única fuente de cifras.
 */
export function buildMatchMessageDraft(input: {
  vehicle: MatchedVehicle;
  demandCode: string;
}): string {
  const { vehicle } = input;
  return [
    `Hola, soy del equipo de Jesús Díaz Automotores.`,
    `Entró una unidad que coincide con lo que estabas buscando: ${vehicle.make} ${vehicle.model} ${vehicle.year}.`,
    `Si te interesa te paso los números y coordinamos para que la veas.`,
  ].join(" ");
}

/**
 * Compradores que podrían estar interesados en una unidad que acaba de entrar.
 *
 * Calcula, guarda y devuelve las coincidencias **sin avisarle a nadie**: el
 * aviso es una acción aparte que aprueba una persona. El sistema prepara el
 * mensaje; no lo manda.
 */
export async function matchVehicleAgainstDemands(
  vehicle: MatchedVehicle,
  runtime: DemandMatchingRuntime = {},
): Promise<readonly DemandMatchView[]> {
  const repository = runtime.repository ?? new D1DemandRepository();
  const now = runtime.now ?? new Date();
  const newId = runtime.newId ?? (() => crypto.randomUUID());
  const threshold = runtime.notifyThresholdBps ?? NOTIFY_THRESHOLD_BPS;

  const demands = await repository.listOpenDemands(now.toISOString());
  const views: DemandMatchView[] = [];
  const rows: Array<{
    id: string;
    demandId: string;
    vehicleId: string;
    scoreBps: number;
    breakdown: unknown;
    createdAt: string;
  }> = [];

  for (const demand of demands as readonly DemandRecord[]) {
    let criteria;
    try {
      criteria = normalizeDemandCriteria(demand.criteria);
    } catch {
      // Una demanda con criterios corruptos no se adivina: se saltea y queda
      // visible en el panel como demanda sin evaluar.
      continue;
    }
    const evaluation = matchVehicleToDemand(criteria, vehicle);
    if (!evaluation.eligible || evaluation.scoreBps < threshold) continue;

    rows.push({
      id: newId(),
      demandId: demand.id,
      vehicleId: vehicle.id,
      scoreBps: evaluation.scoreBps,
      breakdown: { criterios: evaluation.breakdown, exclusiones: evaluation.exclusions },
      createdAt: now.toISOString(),
    });
    views.push({
      demandId: demand.id,
      demandCode: demand.publicCode,
      leadId: demand.leadId,
      assignedTo: demand.assignedTo,
      scoreBps: evaluation.scoreBps,
      scorePercent: percent(evaluation.scoreBps),
      breakdown: evaluation.breakdown,
      draft: buildMatchMessageDraft({ vehicle, demandCode: demand.publicCode }),
    });
  }

  await repository.saveMatches(rows);
  return Object.freeze(
    views.sort((left, right) => right.scoreBps - left.scoreBps),
  );
}
