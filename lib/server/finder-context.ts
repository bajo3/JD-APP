import type { StockRepository } from "@/lib/data/repositories";
import { isFinanceableCurrency } from "../domain/financing.mjs";

export type FinderVehicleContext = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;

const PUBLIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Treats the URL value only as a lookup hint. The returned identity always
 * comes from the current AVAILABLE stock repository record.
 */
export async function resolveFinderVehicleContext(
  value: string | string[] | undefined,
  stock: Pick<StockRepository, "findBySlug">,
): Promise<FinderVehicleContext | null> {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  if (!slug || slug.length > 120 || !PUBLIC_SLUG.test(slug)) return null;

  const vehicle = await stock.findBySlug(slug);
  if (!vehicle || vehicle.status !== "AVAILABLE") return null;
  // Una unidad cotizada en dólares no se preselecciona: el buscador calcula
  // cuotas contra el tarifario en pesos y no hay tipo de cambio confirmado.
  if (!isFinanceableCurrency(vehicle.currency)) return null;

  return {
    id: vehicle.id,
    slug: vehicle.slug,
    name: [vehicle.make, vehicle.model, vehicle.trim]
      .filter(Boolean)
      .join(" "),
  };
}
