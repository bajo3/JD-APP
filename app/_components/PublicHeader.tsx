import Image from "next/image";
import Link from "next/link";
import type { PublicProfileView } from "@/lib/server/public-data";
import { contactHref, contactLabel } from "./contact";

export function PublicHeader({ profile }: { profile: PublicProfileView | null }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Jesús Díaz Automotores, inicio">
        <Image className="brand-logo" src="/logo.jpg" alt="Jesús Díaz Automotores" width={801} height={253} priority />
      </Link>
      <nav className="public-nav" aria-label="Navegación principal">
        <Link href="/stock">Stock</Link>
        <Link href="/tasar-mi-usado">Tasá tu usado</Link>
        <Link href="/contacto">Contacto</Link>
        <Link href="/cuenta">Mi cuenta</Link>
      </nav>
      <a className="header-whatsapp" href={contactHref(profile)}>
        {contactLabel(profile)} <span>↗</span>
      </a>
    </header>
  );
}
