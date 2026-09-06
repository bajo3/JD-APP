import type { Metadata } from "next";
import { PublicShell } from "../_components/PublicShell";
import { Suspense } from "react";
import StockCatalog from "../_components/StockCatalog";
import { getPublicStockData } from "@/lib/server/public-data";
import "./catalog.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stock de usados | Jesús Díaz Automotores",
  description: "Vehículos usados publicados por Jesús Díaz Automotores en Tandil.",
};

export default async function StockPage() {
  const data = await getPublicStockData();
  return (
    <PublicShell>
      <main id="contenido" className="public-page">
        <div className="page-intro">
          <p className="eyebrow">NUESTRO STOCK</p>
          <h1>Encontrá tu próximo auto</h1>
          <p>Vehículos seleccionados y publicados para que consultes su disponibilidad actual.</p>
          <p className="detail-meta">{data.sourceLabel}. Cada ficha informa cuándo se actualizó.</p>
        </div>
        <Suspense fallback={<p className="detail-meta">Cargando catálogo…</p>}>
          <StockCatalog vehicles={data.vehicles} />
        </Suspense>
      </main>
    </PublicShell>
  );
}
