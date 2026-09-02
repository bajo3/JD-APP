import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { FavoriteButton } from "../../_components/AccountActions";
import { contactHref } from "../../_components/contact";
import { VehicleJsonLd } from "../../_components/JsonLd";
import { PublicShell } from "../../_components/PublicShell";
import { VehicleGallery } from "../../_components/VehicleGallery";
import { readFavoriteContext } from "@/lib/server/account-api";
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
  const favorite = await readFavoriteContext((await headers()).get("cookie"), vehicle.id);

  const message = `Hola, quiero consultar por el ${vehicle.name} ${vehicle.year}.`;
  return (
    <PublicShell>
      <main id="contenido" className="public-page detail-page">
        <a className="back-link" href="/stock">← Volver al stock</a>
        <div className="detail-layout">
          {vehicle.images.length > 1 ? (
            <VehicleGallery
              images={vehicle.images}
              tone={vehicle.tone}
              type={vehicle.type}
              slug={vehicle.slug}
            />
          ) : (
            <div className={`detail-image ${vehicle.tone}`}>
              <span>{vehicle.type}</span>
              {image ? <Image className="detail-real-image" src={image.url} alt={image.alt} width={image.width} height={image.height} unoptimized /> : <div className="detail-car" aria-hidden="true"><i/><i/></div>}
            </div>
          )}
          <div className="detail-copy">
            <p className="eyebrow">UNIDAD PUBLICADA</p>
            <h1>{vehicle.name}</h1>
            <p className="detail-meta">{vehicle.year} · {vehicle.km}</p>
            <strong className="detail-price">{vehicle.price}</strong>
            <p>{vehicle.availabilityLabel}. {vehicle.updatedLabel}.</p>
            {data.demo ? <p className="detail-meta">Dato de demostración: no representa una publicación comercial real.</p> : null}
            <p>Coordiná una visita para confirmar la unidad, su documentación y las condiciones vigentes.</p>
            {vehicle.financeable ? null : (
              <p className="detail-meta">
                Unidad cotizada en dólares: la financiación no se simula en la
                web porque el tarifario se publica en pesos. Consultá las
                condiciones vigentes con un vendedor.
              </p>
            )}
            <div className="detail-actions">
              <FavoriteButton
                vehicleId={vehicle.id}
                slug={vehicle.slug}
                initiallySaved={favorite.saved}
                signedIn={favorite.signedIn}
              />
              {vehicle.financeable ? (
                <Link
                  className="primary-button"
                  href={`/que-auto-me-llevo?vehiculo=${encodeURIComponent(vehicle.slug)}`}
                >
                  Simular esta unidad <span>→</span>
                </Link>
              ) : null}
              <a
                className={vehicle.financeable ? "context-secondary-link" : "primary-button"}
                href={contactHref(data.profile, message)}
              >
                {vehicle.financeable
                  ? data.profile?.whatsappE164 ? "Consultar por WhatsApp" : "Dejar una consulta"
                  : "Consultar financiación"} <span>{vehicle.financeable ? "↗" : "→"}</span>
              </a>
            </div>
          </div>
        </div>
        <VehicleJsonLd vehicle={vehicle} demo={data.demo} />
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
