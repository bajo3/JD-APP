import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { DemoNotice, PanelMetric } from "./_components/PanelCards";
import { PanelShell } from "./_components/PanelShell";

export default async function PanelPage() {
  const { overview } = await getAdminPanelData();
  const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
  return <PanelShell title="Resumen" subtitle="Actividad calculada desde los registros operativos.">
    <DemoNotice isDemo={overview.isDemo} />
    <section className="panel-metrics">
      <PanelMetric label="Leads nuevos" value={String(overview.leads.NEW)} trend={`${total(overview.leads)} totales`} accent="orange" />
      <PanelMetric label="Vehículos disponibles" value={String(overview.stock.AVAILABLE)} trend={`${total(overview.stock)} en inventario`} />
      <PanelMetric label="Tasaciones pendientes" value={String(overview.appraisals.SUBMITTED + overview.appraisals.IN_REVIEW)} trend={`${total(overview.appraisals)} solicitudes`} />
      <PanelMetric label="Ofertas activas" value={String(overview.promotions.ACTIVE)} trend={`${overview.promotions.SCHEDULED} programadas`} />
    </section>
    <section className="panel-card"><p className="panel-kicker">CONTROL OPERATIVO</p><h2>Datos conectados y auditados</h2><p className="panel-muted">Cada alta y cambio de estado vuelve a verificar permisos, versión vigente y reglas del negocio.</p></section>
  </PanelShell>;
}
