import type { PublicProfileView } from "@/lib/server/public-data";

export function jsonLd(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function JsonLdScript({ payload }: { payload: unknown }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(payload) }} />
  );
}

// Structured data mirrors the confirmed business profile only. Without a
// loaded profile nothing is declared: search engines must not read an
// address or phone that the business never confirmed.
export function DealerJsonLd({ profile }: { profile: PublicProfileView | null }) {
  if (!profile) return null;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return (
    <JsonLdScript
      payload={{
        "@context": "https://schema.org",
        "@type": "AutoDealer",
        name: profile.name,
        ...(site ? { url: site } : {}),
        ...(profile.phoneNational ? { telephone: profile.phoneNational } : {}),
        address: {
          "@type": "PostalAddress",
          ...(profile.address ? { streetAddress: profile.address } : {}),
          ...(profile.city ? { addressLocality: profile.city } : {}),
          addressCountry: "AR",
        },
      }}
    />
  );
}

// A vehicle is only published as a structured offer when the record comes
// from real stock: demo seeds must never look like a commercial listing.
export function VehicleJsonLd({
  vehicle,
  demo,
}: {
  vehicle: Readonly<{
    slug: string;
    name: string;
    year: string;
    priceCents: number;
    availability: "AVAILABLE_TODAY" | "CHECK_AVAILABILITY";
    image: Readonly<{ url: string }> | null;
  }>;
  demo: boolean;
}) {
  if (demo) return null;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const url = site ? `${site}/autos/${vehicle.slug}` : undefined;
  return (
    <JsonLdScript
      payload={{
        "@context": "https://schema.org",
        "@type": "Car",
        name: vehicle.name,
        ...(vehicle.year ? { vehicleModelDate: vehicle.year } : {}),
        ...(url ? { url } : {}),
        ...(vehicle.image && site && vehicle.image.url.startsWith("/")
          ? { image: `${site}${vehicle.image.url}` }
          : {}),
        offers: {
          "@type": "Offer",
          price: (vehicle.priceCents / 100).toFixed(2),
          priceCurrency: "ARS",
          ...(url ? { url } : {}),
          ...(vehicle.availability === "AVAILABLE_TODAY"
            ? { availability: "https://schema.org/InStock" }
            : {}),
        },
      }}
    />
  );
}
