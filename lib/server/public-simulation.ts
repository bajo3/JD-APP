import type { SimulationRow } from "@/db/schema";
import type { StockVehicle } from "@/lib/data/repositories";

// The customer view of a frozen operation. It carries the persisted snapshot
// and nothing else: no lead, no idempotency hash, no recalculation. The seller
// panel reads the same row, so both sides must show the same amounts.
export type PublicSimulationView = Readonly<{
  publicCode: string;
  status: string;
  classification: string;
  certaintyLevel: string;
  vehicleLabel: string | null;
  vehicleSlug: string | null;
  vehicleAvailable: boolean;
  amounts: Readonly<{
    currency: string;
    listedPriceCents: number;
    effectivePriceCents: number;
    appraisalAppliedCents: number;
    tradeInBonusCents: number;
    cashCents: number;
    financePrincipalCents: number;
    installmentCents: number | null;
    totalCostCents: number | null;
  }>;
  termMonths: number | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  disclaimer: string;
}>;

const CODE_PATTERN = /^[A-Z0-9-]{4,40}$/;

// Codes travel in a URL, so they are normalized before the lookup and a
// malformed one is indistinguishable from a missing one for the caller.
export function normalizePublicCode(value: string): string | null {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const normalized = decoded.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

export function publicSimulationView(
  simulation: SimulationRow,
  vehicle: StockVehicle | null,
  now: Date,
): PublicSimulationView {
  const available = vehicle?.status === "AVAILABLE";
  return {
    publicCode: simulation.publicCode,
    status: simulation.status,
    classification: simulation.classification,
    certaintyLevel: simulation.certaintyLevel,
    vehicleLabel: vehicle
      ? [vehicle.make, vehicle.model, vehicle.trim, vehicle.year]
          .filter((part) => part !== null && part !== undefined && `${part}`.trim() !== "")
          .join(" ")
      : null,
    // The unit is only linked while it is still published.
    vehicleSlug: available ? (vehicle?.slug ?? null) : null,
    vehicleAvailable: available,
    amounts: {
      currency: simulation.currency,
      listedPriceCents: simulation.vehiclePriceCents,
      effectivePriceCents: simulation.effectivePriceCents,
      appraisalAppliedCents: simulation.appraisalAppliedCents,
      tradeInBonusCents: simulation.tradeInBonusCents,
      cashCents: simulation.cashCents,
      financePrincipalCents: simulation.financePrincipalCents,
      installmentCents: simulation.installmentCents,
      totalCostCents: simulation.totalCostCents,
    },
    termMonths: simulation.termMonths,
    createdAt: simulation.createdAt,
    expiresAt: simulation.expiresAt,
    expired: Date.parse(simulation.expiresAt) <= now.getTime(),
    disclaimer: simulation.disclaimerSnapshot,
  };
}
