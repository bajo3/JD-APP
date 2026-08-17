import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function ValuationsPage() {
  const { overview, appraisals } = await getAdminPanelData();
  const records = appraisals.map((item) => ({id:item.id,label:item.vehicle,status:item.status,version:item.version}));
  return <PanelShell title="Tasaciones" subtitle="Revisión humana, rango, certeza y vigencia.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="appraisal" records={records} />
    <section className="panel-card">
      <h2>Solicitudes</h2>
      <AdminTable rows={appraisals} columns={[{key:"name",label:"Lead"},{key:"vehicle",label:"Vehículo"},{key:"createdAt",label:"Recibida"},{key:"status",label:"Estado"}]} actions={[
        {label:"Iniciar revisión",endpoint:"/api/v1/admin/appraisals",nextStatus:"IN_REVIEW",statuses:["SUBMITTED"]},
        {label:"Aprobar",endpoint:"/api/v1/admin/appraisals",nextStatus:"APPROVED",statuses:["ESTIMATED"]},
      ]} />
    </section>
  </PanelShell>;
}
