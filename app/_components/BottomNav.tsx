import Link from "next/link";
import type { PublicProfileView } from "@/lib/server/public-data";
import { contactHref, contactLabel } from "./contact";

export function BottomNav({ profile }: { profile: PublicProfileView | null }) {
  return (
    <nav className="bottom-nav" aria-label="Accesos rápidos">
      <Link href="/"><span aria-hidden="true">⌂</span>Inicio</Link>
      <Link href="/stock"><span aria-hidden="true">▣</span>Stock</Link>
      <Link href="/que-auto-me-llevo"><span aria-hidden="true">?</span>Ayuda</Link>
      <a href={contactHref(profile)}><span aria-hidden="true">◉</span>{contactLabel(profile)}</a>
    </nav>
  );
}
