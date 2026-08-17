import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "../../_components/PublicShell";
import { getPublicVehicleDetail } from "@/lib/server/public-data";

export const dynamic = "force-dynamic";

type VehicleDetailProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: VehicleDetailProps): Promise<Metadata> {
  const { slug } = await params;
  const { vehicle } = await getPublicVehicleDetail(slug);
  if (!vehicle) {
    return {
      title: "Vehículo no disponible | Jesús Díaz Automotores",
      description: "La unidad consultada ya no forma parte del stock publicado.",
      robots: { index: false, follow: false },
    };
  }
  const description = `${vehicle.name} ${vehicle.year}, ${vehicle.km}, ${vehicle.price}. ${vehicle.availabilityLabel}.`;
  return {
    title: `${vehicle.name} ${vehicle.year} | Jesús Díaz Automotores`,
    description,
    openGraph: {
      title: `${vehicle.name} ${vehicle.year}`,
      description,
      type: "website",
    },
  };
}

export default async function VehicleDetail({ params }: VehicleDetailProps) {
  const { slug } = await params;
  const data = await getPublicVehicleDetail(slug);
  const vehicle = data.vehicle;
  if (!vehicle) notFound();

  const message = encodeURIComponent(
    `Hola, quiero consultar por el ${vehicle.name} ${vehicle.year}.`,
  );
  return (
    <PublicShell>
      <main className="public-page detail-page">
        <a className="back-link" href="/stock">← Volver al stock</a>
        <div className="detail-layout">
          <div className={`detail-image ${vehicle.tone}`}>
            <span>{vehicle.type}</span>
            <div className="detail-car" aria-hidden="true"><i/><i/></div>
          </div>
          <div className="detail-copy">
            <p className="eyebrow">UNIDAD PUBLICADA</p>
            <h1>{vehicle.name}</h1>
            <p className="detail-meta">{vehicle.year} · {vehicle.km}</p>
            <strong className="detail-price">{vehicle.price}</strong>
            <p>{vehicle.availabilityLabel}. {vehicle.updatedLabel}.</p>
            {data.demo ? <p className="detail-meta">Dato de demostración: no representa una publicación comercial real.</p> : null}
            <p>Coordiná una visita para confirmar la unidad, su documentación y las condiciones vigentes.</p>
            <a className="primary-button" href={`https://wa.me/5492494587046?text=${message}`}>
              Consultar por WhatsApp <span>↗</span>
            </a>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}
