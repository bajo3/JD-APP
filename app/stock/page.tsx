import type { Metadata } from "next";
import { PublicShell } from "../_components/PublicShell";
import { VehicleCard } from "../_components/VehicleCard";
import { getPublicStockData } from "@/lib/server/public-data";

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
        <div className="stock-toolbar">
          <strong>{data.vehicles.length} {data.vehicles.length === 1 ? "vehículo publicado" : "vehículos publicados"}</strong>
          <select defaultValue="recommended" aria-label="Ordenar stock">
            <option value="recommended">Más relevantes</option>
            <option value="price">Menor precio</option>
            <option value="year">Más nuevos</option>
          </select>
        </div>
        {data.vehicles.length > 0 ? (
          <div className="vehicle-grid stock-grid">
            {data.vehicles.map((vehicle) => <VehicleCard key={vehicle.slug} vehicle={vehicle} />)}
          </div>
        ) : (
          <p className="detail-meta">No hay unidades publicadas en este momento. Consultanos por próximos ingresos.</p>
        )}
      </main>
    </PublicShell>
  );
}
