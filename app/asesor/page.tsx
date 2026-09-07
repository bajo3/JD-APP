import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "../_components/PublicShell";
import { WebAdvisorChat } from "../_components/WebAdvisorChat";
import "./advisor.css";

export const metadata: Metadata = {
  title: "Asesor JD | Jesús Díaz Automotores",
  description: "Orientación para encontrar tu próximo auto.",
  robots: { index: false, follow: false },
};

export default function AdvisorPage() {
  return (
    <PublicShell>
      <main id="contenido" className="public-page advisor-page">
        <div className="advisor-intro">
          <p className="eyebrow">ASISTENTE VIRTUAL DE JDA</p>
          <h1>Hablemos de tu próximo auto</h1>
          <p>Contame qué necesitás y te voy a orientar con la información disponible.</p>
          <nav className="advisor-permanent-links" aria-label="Accesos rápidos">
            <Link href="/stock">Explorar stock</Link>
            <Link href="/que-auto-me-llevo">Calcular qué auto llevarte</Link>
            <Link href="/contacto">Contacto</Link>
          </nav>
        </div>
        <WebAdvisorChat />
      </main>
    </PublicShell>
  );
}
