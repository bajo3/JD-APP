import { ChannelAccountForm } from "../_components/ChannelAccountForm";
import { ChannelAdvisorControls } from "../_components/ChannelAdvisorControls";
import { PanelShell } from "../_components/PanelShell";
import Link from "next/link";
import { getPanelConfigurationData } from "@/lib/server/inbox-panel-data";
import { advisorIsConfigured, configuredAdvisorProvider } from "@/lib/server/advisor-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateTime = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const STOCK_STATUS: Record<string, string> = {
  COMPLETED: "Correcta",
  COMPLETED_WITH_REJECTIONS: "Correcta, con unidades omitidas",
  FAILED: "Falló",
};

export default async function ConfiguracionPage() {
  const { accounts, stock } = await getPanelConfigurationData();
  const activeCount = accounts.filter((account) => account.status === "ACTIVE").length;
  const advisorCount = accounts.filter((account) => account.advisorEnabled).length;
  const canActivateAdvisor = advisorIsConfigured();
  const advisorProvider = configuredAdvisorProvider();
  const advisorProviderLabel = advisorProvider === "openai" ? "OpenAI listo" : advisorProvider === "anthropic" ? "Anthropic listo" : "falta la clave de IA";

  return (
    <PanelShell title="Configuración" subtitle="Conexiones, automatización y fuentes de datos del negocio.">
      <section className="panel-metrics settings-metrics" aria-label="Estado de integraciones">
        <div className="panel-metric orange"><span>Canales activos</span><strong>{activeCount}</strong><small>de {accounts.length} sincronizados</small></div>
        <div className="panel-metric"><span>Agentes activos</span><strong>{advisorCount}</strong><small>{advisorProviderLabel} · apagados por defecto</small></div>
        <div className="panel-metric"><span>Stock JD‑Auto</span><strong>{stock.availableVehicles}</strong><small>unidades disponibles sincronizadas</small></div>
      </section>

      <section className="panel-card settings-card" aria-labelledby="advisor-title">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">AGENTE COMERCIAL</p>
            <h2 id="advisor-title">Respuesta automática por canal</h2>
            <p className="panel-muted">Cada canal tiene su propio interruptor. Al desactivarlo, el equipo recupera inmediatamente la atención.</p>
          </div>
          <Link className="panel-action panel-primary" href="/panel/probar-bot">Probar bot</Link>
        </div>
        <ChannelAdvisorControls accounts={accounts} canActivate={canActivateAdvisor} />
        <p className="settings-safety-note">El agente entiende texto, fotos y notas de voz, y consulta únicamente el stock vigente de JD‑App sincronizado desde JD‑Auto. Si no puede entender o verificar un dato, deriva la conversación sin inventarlo.</p>
      </section>

      <section className="panel-card settings-card" aria-labelledby="zernio-title">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">CONEXIÓN DE CANALES</p>
            <h2 id="zernio-title">Zernio</h2>
            <p className="panel-muted">Conectá y sincronizá WhatsApp, Instagram y Messenger; verificá acá el webhook.</p>
          </div>
        </div>
        <ChannelAccountForm />
      </section>

      <section className="panel-card settings-card" aria-labelledby="stock-source-title">
        <p className="panel-kicker">FUENTE DE VERDAD</p>
        <h2 id="stock-source-title">Inventario de JD‑Auto</h2>
        <p className="panel-muted">JD‑Auto aporta la identidad y disponibilidad de cada unidad; su planilla comercial aporta precio y moneda. JD‑App sólo publica unidades completas con precio, versión, año, kilometraje y fotos válidas.</p>
        <dl className="settings-source-status">
          <div><dt>Última sincronización</dt><dd>{stock.finishedAt ? dateTime.format(new Date(stock.finishedAt)) : "Todavía sin registro"}</dd></div>
          <div><dt>Estado</dt><dd>{stock.status ? STOCK_STATUS[stock.status] ?? stock.status : "Sin ejecutar"}</dd></div>
          <div><dt>Leídas / cambiadas</dt><dd>{stock.recordsSeen} / {stock.recordsChanged}</dd></div>
        </dl>
      </section>
    </PanelShell>
  );
}
