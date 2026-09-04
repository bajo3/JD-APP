import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";
import Link from "next/link";

export default async function ValuationsPage() {
  const { overview, appraisals } = await getAdminPanelData();
  const records = appraisals.map((item) => ({id:item.id,label:item.vehicle,status:item.status,version:item.version}));
  return <PanelShell title="Tasaciones" subtitle="Revisión humana, rango, certeza y vigencia.">
    <DemoNotice isDemo={overview.isDemo} />
    <section className="panel-card"><div className="panel-card-head"><div><p className="panel-kicker">TARIFARIO</p><h2>Referencias de permuta</h2><p className="panel-muted">Sólo una versión publicada y vigente puede dar un rango preliminar por WhatsApp.</p></div><Link className="panel-action panel-primary" href="/panel/tasaciones/referencias">Administrar referencias</Link></div></section>
    <AdminResourceForm resource="appraisal" records={records} />
    <section className="panel-card">
      <h2>Solicitudes</h2>
      <AdminTable rows={appraisals} columns={[{key:"name",label:"Lead"},{key:"vehicle",label:"Vehículo",linkBase:"/panel/tasaciones/"},{key:"createdAt",label:"Recibida"},{key:"status",label:"Estado"}]} actions={[
        {label:"Iniciar revisión",endpoint:"/api/v1/admin/appraisals",nextStatus:"IN_REVIEW",statuses:["SUBMITTED"]},
        {label:"Aprobar",endpoint:"/api/v1/admin/appraisals",nextStatus:"APPROVED",statuses:["ESTIMATED"]},
      ]} />
    </section>
  </PanelShell>;
}
