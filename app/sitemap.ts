import type { MetadataRoute } from "next";
import { getDataAccess } from "@/lib/server/data-access";

// Only public marketing surfaces are listed. Operation codes
// (/simulaciones/**), the offline shell and the panel never enter the sitemap.
const STATIC_PATHS = [
  "/",
  "/stock",
  "/tasar-mi-usado",
  "/que-auto-me-llevo",
  "/oferta-del-dia",
  "/contacto",
] as const;

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "";
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/stock" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));

  let vehicles: readonly { slug: string; updatedAt: string }[] = [];
  try {
    vehicles = await getDataAccess().stock.listAvailable();
  } catch {
    // A stock read failure must never break the sitemap: the static
    // surfaces are still valid on their own.
    return entries;
  }

  return [
    ...entries,
    ...vehicles.map((vehicle) => ({
      url: `${base}/autos/${vehicle.slug}`,
      lastModified: new Date(vehicle.updatedAt),
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
