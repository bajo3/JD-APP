import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
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
  const imageUrl = vehicle.image
    ? absoluteRequestUrl(vehicle.image.url, await headers())
    : null;
  return {
    title: `${vehicle.name} ${vehicle.year} | Jesús Díaz Automotores`,
    description,
    openGraph: {
      title: `${vehicle.name} ${vehicle.year}`,
      description,
      type: "website",
      images: imageUrl
        ? [{ url: imageUrl, alt: vehicle.image?.alt ?? vehicle.name }]
        : [],
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: `${vehicle.name} ${vehicle.year}`,
      description,
      images: imageUrl ? [imageUrl] : [],
    },
  };
}

export default async function VehicleDetail({ params }: VehicleDetailProps) {
  const { slug } = await params;
  const data = await getPublicVehicleDetail(slug);
  const vehicle = data.vehicle;
  if (!vehicle) notFound();
  const image = vehicle.image;

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
            {image ? <Image className="detail-real-image" src={image.url} alt={image.alt} width={image.width} height={image.height} unoptimized /> : <div className="detail-car" aria-hidden="true"><i/><i/></div>}
          </div>
          <div className="detail-copy">
            <p className="eyebrow">UNIDAD PUBLICADA</p>
            <h1>{vehicle.name}</h1>
            <p className="detail-meta">{vehicle.year} · {vehicle.km}</p>
            <strong className="detail-price">{vehicle.price}</strong>
            <p>{vehicle.availabilityLabel}. {vehicle.updatedLabel}.</p>
            {data.demo ? <p className="detail-meta">Dato de demostración: no representa una publicación comercial real.</p> : null}
            <p>Coordiná una visita para confirmar la unidad, su documentación y las condiciones vigentes.</p>
            <a
              className="primary-button"
              href={data.profile?.whatsappE164
                ? `https://wa.me/${data.profile.whatsappE164.replace(/\D/g, "")}?text=${message}`
                : "/contacto"}
            >
              {data.profile?.whatsappE164 ? "Consultar por WhatsApp" : "Dejar una consulta"} <span>↗</span>
            </a>
          </div>
        </div>
      </main>
    </PublicShell>
  );
}

function absoluteRequestUrl(path: string, requestHeaders: Headers): string {
  if (/^https?:\/\//i.test(path)) return path;
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return path;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return new URL(path, `${protocol}://${host}`).toString();
}
