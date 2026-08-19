import Link from "next/link";
import type { PublicProfileView } from "@/lib/server/public-data";
import { contactHref, contactLabel } from "./contact";

export function PublicHeader({ profile }: { profile: PublicProfileView | null }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Jesús Díaz Automotores, inicio">
        <span className="brand-mark">JD</span>
        <span><strong>JESÚS DÍAZ</strong><small>AUTOMOTORES</small></span>
      </Link>
      <nav className="public-nav" aria-label="Navegación principal">
        <Link href="/stock">Stock</Link>
        <Link href="/tasar-mi-usado">Tasá tu usado</Link>
        <Link href="/contacto">Contacto</Link>
      </nav>
      <a className="header-whatsapp" href={contactHref(profile)}>
        {contactLabel(profile)} <span>↗</span>
      </a>
    </header>
  );
}
