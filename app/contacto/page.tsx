import type { Metadata } from "next";
import { PublicShell } from "../_components/PublicShell";
import { LeadForm } from "../_components/LeadForm";
import { getPublicProfile } from "@/lib/server/public-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contacto | Jesús Díaz Automotores",
  description: "Escribinos y coordinamos una visita al salón.",
};

export default async function ContactPage() {
  const profile = await getPublicProfile();
  return (
    <PublicShell>
      <main id="contenido" className="public-page contact-page">
        <div className="form-intro">
          <p className="eyebrow">ESTAMOS PARA AYUDARTE</p>
          <h1>Hablemos de tu próximo auto</h1>
          <p>
            {profile?.city
              ? `Escribinos y coordinamos una visita en nuestro salón de ${profile.city}.`
              : "Escribinos y coordinamos una visita al salón."}
          </p>
          <div className="contact-data">
            <span aria-hidden="true">⌖</span>
            <div>
              <strong>{profile?.address ?? "Dirección a confirmar"}</strong>
              <small>{profile?.city ?? "Coordinamos el punto de encuentro"}</small>
            </div>
            <span aria-hidden="true">◷</span>
            <div>
              <strong>Coordiná tu visita</strong>
              <small>{profile?.whatsappE164 ? "por WhatsApp" : "dejanos tu consulta"}</small>
            </div>
          </div>
        </div>
        <LeadForm />
      </main>
    </PublicShell>
  );
}
