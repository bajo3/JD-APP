import type { Metadata } from "next";
import { AccountAuthForm } from "../../_components/AccountAuthForm";
import { PublicShell } from "../../_components/PublicShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ingresar | Jesús Díaz Automotores",
  description: "Ingresá a tu cuenta para ver tus favoritos, búsquedas y consultas.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <PublicShell>
      <main id="contenido" className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">TU CUENTA</p>
          <h1>Ingresá</h1>
          <p>Volvé a lo que estabas mirando y seguí desde ahí.</p>
        </div>
        <AccountAuthForm mode="login" />
      </main>
    </PublicShell>
  );
}
