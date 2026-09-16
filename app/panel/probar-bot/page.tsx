import Link from "next/link";
import { PanelShell } from "../_components/PanelShell";
import { AdvisorTestPanel } from "../_components/AdvisorTestPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProbarBotPage() {
  return (
    <PanelShell title="Probar bot" subtitle="Ensayá al agente con una conversación aislada antes de activarlo en un canal.">
      <section className="panel-card settings-card" aria-labelledby="advisor-test-title">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">PLAYGROUND INTERNO</p>
            <h2 id="advisor-test-title">Conversación de prueba</h2>
            <p className="panel-muted">La charla no queda guardada y las acciones comerciales están bloqueadas. Cuando el resultado te cierre, activás el agente por canal desde Configuración.</p>
          </div>
          <Link className="panel-action" href="/panel/configuracion">Ir a configuración</Link>
        </div>
        <AdvisorTestPanel />
      </section>
    </PanelShell>
  );
}
