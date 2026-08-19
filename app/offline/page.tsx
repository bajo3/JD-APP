import Link from "next/link";
import { StaticPublicShell } from "../_components/PublicShell";

export const metadata = {
  title: "Sin conexión | Jesús Díaz Automotores",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <StaticPublicShell>
      <main id="contenido" className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">SIN CONEXIÓN</p>
          <h1>No pudimos cargar esta página</h1>
          <p>
            Estás sin conexión. El stock, los precios y las ofertas necesitan internet para estar
            al día: cuando vuelvas a conectarte, la información se actualiza sola.
          </p>
        </div>
        <div className="detail-actions">
          <Link className="context-secondary-link" href="/">
            Volver al inicio <span>→</span>
          </Link>
        </div>
      </main>
    </StaticPublicShell>
  );
}
