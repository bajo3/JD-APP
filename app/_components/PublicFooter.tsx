import Image from "next/image";
import Link from "next/link";
import type { PublicProfileView } from "@/lib/server/public-data";
import { contactHref } from "./contact";

export function PublicFooter({ profile }: { profile: PublicProfileView | null }) {
  const href = contactHref(profile);
  const phone = profile?.phoneNational?.trim();
  const place = [profile?.address, profile?.city].filter(Boolean).join(" · ");

  return (
    <footer id="contacto">
      <div>
        <Image className="footer-logo" src="/logo.jpg" alt="Jesús Díaz Automotores" width={801} height={253} />
      </div>
      <p>Estamos para ayudarte a encontrar tu próximo auto.</p>
      {profile?.whatsappE164 ? (
        <a href={href}>WhatsApp{phone ? ` · ${phone}` : ""}</a>
      ) : (
        <Link href="/contacto">Dejanos tu consulta</Link>
      )}
      {place ? <span>{place}</span> : null}
    </footer>
  );
}
