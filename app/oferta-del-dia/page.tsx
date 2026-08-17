import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { OfferCountdown } from "../_components/OfferCountdown";
import { PublicShell } from "../_components/PublicShell";
import { getPublicOfferData } from "@/lib/server/public-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Oferta JD del Día | Jesús Díaz Automotores",
  description: "Consultá la promoción vigente y sus condiciones publicadas.",
};

export default async function OfferPage() {
  const data = await getPublicOfferData();
  const offer = data.promotion;
  const offerImage = offer?.vehicle?.image;

  return (
    <PublicShell>
      <main className="public-page offer-detail-page">
        <p className="eyebrow">OPORTUNIDAD EXCLUSIVA · VIGENCIA LIMITADA</p>
        <h1>Oferta JD del Día</h1>
        {offer ? (
          <div className="offer-detail-card">
            <div className="offer-photo">
              <span className="offer-badge">OFERTA JD<br/><b>DEL DÍA</b></span>
              {offerImage ? <Image className="offer-real-image" src={offerImage.url} alt={offerImage.alt} width={offerImage.width} height={offerImage.height} unoptimized /> : <div className="offer-car" aria-hidden="true"><span/><i/><i/></div>}
            </div>
            <div className="offer-content">
              <h2>{offer.vehicle?.name ?? offer.title}</h2>
              <p className="offer-details">
                {offer.vehicle
                  ? `${offer.vehicle.year} · ${offer.vehicle.km} · ${offer.vehicle.availabilityLabel}`
                  : "La promoción está vigente; la unidad alcanzada requiere confirmación"}
              </p>
              <div className="offer-price">
                <span>{offer.benefitLabel}</span>
                <strong>{offer.effectivePrice ?? "Consultá las condiciones"}</strong>
                {offer.normalPrice && offer.effectivePrice !== offer.normalPrice ? (
                  <span>Precio publicado sin promoción: {offer.normalPrice}</span>
                ) : null}
                {offer.vehicle ? <span>{offer.vehicle.updatedLabel}</span> : null}
              </div>
              <p>{offer.description}</p>
              <p className="detail-meta">{offer.validityLabel}. Sujeta a disponibilidad y verificación de condiciones.</p>
              {data.demo ? <p className="detail-meta">Dato de demostración: esta promoción no constituye una oferta comercial real.</p> : null}
              <div className="offer-actions">
                <div className="offer-action-links">
                  {offer.vehicle ? (
                    <Link
                      className="primary-button"
                      href={`/que-auto-me-llevo?vehiculo=${encodeURIComponent(offer.vehicle.slug)}`}
                    >
                      Calcular esta oferta con mi usado <span>→</span>
                    </Link>
                  ) : null}
                  <a
                    className={offer.vehicle ? "context-secondary-link" : "primary-button"}
                    href={offerContactHref(data.profile?.whatsappE164, offer.vehicle?.name)}
                  >
                    {data.profile?.whatsappE164 ? "Consultar ahora" : "Dejar una consulta"} <span>↗</span>
                  </a>
                </div>
                <OfferCountdown endsAt={offer.endsAt} />
              </div>
            </div>
          </div>
        ) : (
          <div className="offer-detail-card">
            <div className="offer-photo"><div className="offer-car" aria-hidden="true"><span/><i/><i/></div></div>
            <div className="offer-content">
              <h2>No hay una promoción vigente</h2>
              <p>En este momento no hay una Oferta JD del Día publicada. Podés revisar las unidades disponibles o pedir una propuesta personalizada.</p>
              <a className="secondary-button" href="/stock">Ver stock publicado <span>→</span></a>
            </div>
          </div>
        )}
      </main>
    </PublicShell>
  );
}

function offerContactHref(
  whatsapp: string | null | undefined,
  vehicleName: string | undefined,
): string {
  if (!whatsapp) return "/contacto";
  const message = vehicleName
    ? `Hola, quiero consultar por la oferta vigente de ${vehicleName}.`
    : "Hola, quiero consultar por la Oferta JD del Día vigente.";
  return `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}
