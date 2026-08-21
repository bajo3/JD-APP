import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { DemoNotice, PanelMetric } from "./_components/PanelCards";
import { PanelShell } from "./_components/PanelShell";

const dateOnly = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "medium",
});

export default async function PanelPage() {
  const { overview, funnel } = await getAdminPanelData();
  const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
  return <PanelShell title="Resumen" subtitle="Actividad calculada desde los registros operativos.">
    <DemoNotice isDemo={overview.isDemo} />
    <section className="panel-metrics">
      <PanelMetric label="Leads nuevos" value={String(overview.leads.NEW)} trend={`${total(overview.leads)} totales`} accent="orange" />
      <PanelMetric label="Vehículos disponibles" value={String(overview.stock.AVAILABLE)} trend={`${total(overview.stock)} en inventario`} />
      <PanelMetric label="Tasaciones pendientes" value={String(overview.appraisals.SUBMITTED + overview.appraisals.IN_REVIEW)} trend={`${total(overview.appraisals)} solicitudes`} />
      <PanelMetric label="Consignaciones por revisar" value={String(overview.consignments.SUBMITTED + overview.consignments.IN_REVIEW)} trend={`${overview.consignments.ACCEPTED} aceptadas`} accent="orange" />
      <PanelMetric label="Ofertas activas" value={String(overview.promotions.ACTIVE)} trend={`${overview.promotions.SCHEDULED} programadas`} />
    </section>

    <section className="panel-card" aria-labelledby="funnel-title">
      <p className="panel-kicker">EMBUDO COMERCIAL</p>
      <h2 id="funnel-title">Del simulador al cierre</h2>
      <p className="panel-muted">
        Últimos 30 días, desde el {dateOnly.format(new Date(funnel.since))}. Cada número sale de
        un registro persistido; los porcentajes comparan cada paso con el anterior.
      </p>
      {funnel.empty ? (
        <p className="panel-muted">Todavía no hay operaciones simuladas en la ventana.</p>
      ) : (
        <ol className="funnel-steps">
          {funnel.steps.map((step) => (
            <li key={step.key}>
              <div className="funnel-head">
                <strong>{step.value}</strong>
                <span>{step.label}</span>
              </div>
              <div
                className="funnel-bar"
                role="img"
                aria-label={`${step.value} de ${funnel.steps[0].value} operaciones`}
              >
                <span style={{ width: `${step.fromStart ?? 100}%` }} />
              </div>
              <small>
                {step.fromPrevious === null
                  ? step.source
                  : `${step.fromPrevious}% del paso anterior · ${step.fromStart}% del total · ${step.source}`}
              </small>
            </li>
          ))}
        </ol>
      )}
      <p className="panel-muted funnel-unmeasured">
        <strong>Sin medir todavía:</strong> {funnel.unmeasured.join(" · ")}. No se estiman:
        requieren telemetría de cliente o el registro de la venta.
      </p>
    </section>

    <section className="panel-card"><p className="panel-kicker">CONTROL OPERATIVO</p><h2>Datos conectados y auditados</h2><p className="panel-muted">Cada alta y cambio de estado vuelve a verificar permisos, versión vigente y reglas del negocio.</p></section>
  </PanelShell>;
}
