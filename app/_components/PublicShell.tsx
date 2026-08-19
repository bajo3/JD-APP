import { getPublicProfile } from "@/lib/server/public-data";
import { DealerJsonLd } from "./JsonLd";
import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";
import { BottomNav } from "./BottomNav";

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const profile = await getPublicProfile();
  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <PublicHeader profile={profile} />
      {children}
      <PublicFooter profile={profile} />
      <BottomNav profile={profile} />
      <DealerJsonLd profile={profile} />
    </>
  );
}

// The offline shell never touches the database: it must render from the
// service worker cache with no server round-trip and no business profile.
export function StaticPublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <PublicHeader profile={null} />
      {children}
      <PublicFooter profile={null} />
      <BottomNav profile={null} />
    </>
  );
}
