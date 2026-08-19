import type { PublicProfileView } from "@/lib/server/public-data";

// Contact surfaces never invent a phone number: without a confirmed profile
// every entry point falls back to the contact form.
export function contactHref(
  profile: PublicProfileView | null,
  message?: string,
): string {
  if (!profile?.whatsappE164) return "/contacto";
  const digits = profile.whatsappE164.replace(/\D/g, "");
  if (!digits) return "/contacto";
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${query}`;
}

export function contactLabel(profile: PublicProfileView | null): string {
  return profile?.whatsappE164 ? "WhatsApp" : "Contacto";
}
