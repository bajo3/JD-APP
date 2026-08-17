import { PublicShell } from "../_components/PublicShell";
import { AffordabilityFlow } from "../_components/AffordabilityFlow";
import { getDataAccess } from "@/lib/server/data-access";

export const dynamic = "force-dynamic";

export default async function FinderPage() {
  const access = getDataAccess();
  const profile = await access.businessProfile.get();
  return (
    <PublicShell>
      <main className="public-page affordability-page">
        <div className="form-intro">
          <p className="eyebrow">TU OPERACIÓN, PASO A PASO</p>
          <h1>¿Qué auto me llevo?</h1>
          <p>Combiná tu usado, efectivo y cuota para descubrir qué unidades podrías alcanzar hoy.</p>
          <p className="detail-meta">Explorá sin registrarte. Pedimos tus datos recién cuando elegís una opción.</p>
        </div>
        <AffordabilityFlow
          contactPhone={profile?.phoneNational ?? "249 458-7046"}
          demo={access.source === "fixture"}
        />
      </main>
    </PublicShell>
  );
}
