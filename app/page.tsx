import type { Metadata } from "next";
import Image from "next/image";
import { contactHref, contactLabel } from "./_components/contact";
import { DealerJsonLd } from "./_components/JsonLd";
import { HeroVehicleRotator, type HeroVehiclePhoto } from "./_components/HeroVehicleRotator";
import { OfferCountdown } from "./_components/OfferCountdown";
import { VehicleCard } from "./_components/VehicleCard";
import { getPublicHomeData } from "@/lib/server/public-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Jesús Díaz Automotores | Tandil",
  description: "Usados seleccionados y atención personalizada en Tandil.",
};

export default async function Home() {
  const data = await getPublicHomeData();
  const profile = data.profile;
  const offer = data.promotion;
  const featured = data.vehicles.slice(0, 3);
  const contactUrl = contactHref(profile);
  const heroPhotos: HeroVehiclePhoto[] = data.vehicles
    .filter((vehicle) => vehicle.image)
    .slice(0, 5)
    .map((vehicle) => ({ url: vehicle.image!.url, alt: vehicle.image!.alt }));

  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <header className="site-header">
        <a className="brand" href="#inicio">
          <Image className="brand-logo" src="/logo.jpg" alt="Jesús Díaz Automotores" width={801} height={253} priority />
        </a>
        <div className="location">
          <span className="pin">⌖</span> {profile?.city ?? "Ubicación a confirmar"}
        </div>
        <a className="header-whatsapp" href={contactUrl}>
          {contactLabel(profile)} <span>↗</span>
        </a>
      </header>

      <main id="contenido">
      <section className="hero" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow">TANDIL · COMPRA INTELIGENTE</p>
          <h1>¿Qué auto te podés llevar <em>hoy?</em></h1>
          <p className="hero-subtitle">Encontrá el vehículo que te acompaña en tu próximo destino.</p>
          <div className="search-card">
            <label>
              Estoy buscando
              <select defaultValue="Usado"><option>Usado</option><option>Utilitario</option></select>
            </label>
            <label>
              Presupuesto
              <select defaultValue="Quiero calcular"><option>Quiero calcular</option><option>Prefiero consultar</option></select>
            </label>
            <label>
              Financiación
              <select defaultValue="Me interesa financiar"><option>Me interesa financiar</option><option>Pago sin financiación</option></select>
            </label>
            <a className="primary-button" href="/que-auto-me-llevo">Calcular operación <span>→</span></a>
          </div>
          <p className="detail-meta">{data.sourceLabel}. La disponibilidad se confirma antes de avanzar.</p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="visual-glow" />
          {heroPhotos.length > 0 ? (
            <HeroVehicleRotator photos={heroPhotos} />
          ) : (
            <div className="hero-car"><span className="car-window"/><span className="car-body"/><i/><i/></div>
          )}
          <div className="visual-caption"><strong>Tu próximo auto</strong><span>está más cerca de lo que pensás.</span></div>
        </div>
      </section>

      <section className="daily-offer">
        <div className="offer-photo">
          <span className="offer-badge">OFERTA JD<br/><b>DEL DÍA</b></span>
          {offer?.vehicle?.image ? (
            <Image
              className="offer-real-image"
              src={offer.vehicle.image.url}
              alt={offer.vehicle.image.alt}
              width={offer.vehicle.image.width}
              height={offer.vehicle.image.height}
              unoptimized
            />
          ) : (
            <div className="offer-car" aria-hidden="true"><span/><i/><i/></div>
          )}
        </div>
        {offer ? (
          <div className="offer-content">
            <p className="eyebrow">OPORTUNIDAD VIGENTE</p>
            <h2>{offer.vehicle?.name ?? offer.title}</h2>
            <p className="offer-details">
              {offer.vehicle
                ? `${offer.vehicle.year} · ${offer.vehicle.km} · ${offer.vehicle.availabilityLabel}`
                : "La unidad alcanzada por la promoción requiere confirmación"}
            </p>
            <div className="offer-price">
              <span>{offer.benefitLabel}</span>
              <strong>{offer.effectivePrice ?? "Consultá las condiciones"}</strong>
              {offer.vehicle ? <span>{offer.vehicle.updatedLabel}</span> : null}
            </div>
            {data.demo ? <p className="detail-meta">Dato de demostración: no constituye una oferta comercial real.</p> : null}
            <div className="offer-actions">
              <a className="secondary-button" href="/oferta-del-dia">Ver oferta vigente <span>→</span></a>
              <OfferCountdown endsAt={offer.endsAt} />
            </div>
          </div>
        ) : (
          <div className="offer-content">
            <p className="eyebrow">PROMOCIONES</p>
            <h2>No hay una oferta vigente</h2>
            <p className="offer-details">Revisá el stock publicado o pedinos una propuesta personalizada.</p>
            <a className="secondary-button" href="/stock">Ver vehículos <span>→</span></a>
          </div>
        )}
      </section>

      <section className="inventory">
        <div className="section-heading">
          <div><p className="eyebrow">ELEGIDOS PARA VOS</p><h2>Vehículos destacados</h2></div>
          <a href="/stock">Ver todos <span>→</span></a>
        </div>
        {featured.length > 0 ? (
          <div className="vehicle-grid">
            {featured.map((vehicle) => <VehicleCard key={vehicle.slug} vehicle={vehicle} />)}
          </div>
        ) : (
          <p className="detail-meta">No hay vehículos publicados en este momento. Consultanos por próximos ingresos.</p>
        )}
      </section>
      </main>

      <footer id="contacto">
        <div><Image className="footer-logo" src="/logo.jpg" alt="Jesús Díaz Automotores" width={801} height={253} /></div>
        <p>Estamos para ayudarte a encontrar tu próximo auto.</p>
        <a href={contactUrl}>
          {contactLabel(profile)}{profile?.phoneNational ? ` · ${profile.phoneNational}` : ""}
        </a>
        <span>{[profile?.address, profile?.city].filter(Boolean).join(" · ") || "Ubicación a confirmar"}</span>
      </footer>
      <DealerJsonLd profile={profile} />
    </>
  );
}
