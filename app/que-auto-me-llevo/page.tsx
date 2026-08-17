import { PublicShell } from "../_components/PublicShell";
import { AffordabilityFlow } from "../_components/AffordabilityFlow";
import { getDataAccess } from "@/lib/server/data-access";
import { resolveFinderVehicleContext } from "@/lib/server/finder-context";

export const dynamic = "force-dynamic";

type FinderPageProps = Readonly<{
  searchParams: Promise<{ vehiculo?: string | string[] }>;
}>;

export default async function FinderPage({ searchParams }: FinderPageProps) {
  const access = getDataAccess();
  const { vehiculo } = await searchParams;
  const [profile, initialVehicle] = await Promise.all([
    access.businessProfile.get(),
    resolveFinderVehicleContext(vehiculo, access.stock),
  ]);
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
          initialVehicle={initialVehicle}
        />
      </main>
    </PublicShell>
  );
}
