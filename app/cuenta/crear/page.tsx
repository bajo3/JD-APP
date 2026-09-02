import type { Metadata } from "next";
import { AccountAuthForm } from "../../_components/AccountAuthForm";
import { PublicShell } from "../../_components/PublicShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crear cuenta | Jesús Díaz Automotores",
  description:
    "Creá tu cuenta para guardar favoritos, búsquedas y el seguimiento de tus tasaciones y simulaciones.",
  robots: { index: false, follow: true },
};

export default function CreateAccountPage() {
  return (
    <PublicShell>
      <main id="contenido" className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">TU CUENTA</p>
          <h1>Creá tu cuenta</h1>
          <p>
            Guardá las unidades que te interesan, tus búsquedas y el seguimiento
            de lo que ya consultaste.
          </p>
          <p className="detail-meta">
            No hace falta para usar la web: el stock, la tasación, el buscador y
            la simulación funcionan igual sin registrarte.
          </p>
        </div>
        <AccountAuthForm mode="register" />
      </main>
    </PublicShell>
  );
}
