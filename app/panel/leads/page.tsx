import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function LeadsPage() {
  const { overview, leads } = await getAdminPanelData();
  const records = leads.map((lead) => ({id:lead.id,label:lead.name,status:lead.status,version:lead.version}));
  return <PanelShell title="Leads" subtitle="Consultas recibidas y seguimiento comercial.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="lead" records={records} />
    <section className="panel-card">
      <h2>Registro operativo</h2>
      <AdminTable rows={leads} columns={[{key:"name",label:"Persona",linkBase:"/panel/leads/"},{key:"interest",label:"Interés"},{key:"createdAt",label:"Ingreso"},{key:"status",label:"Estado"}]} actions={[
        {label:"Marcar contactado",endpoint:"/api/v1/admin/leads",nextStatus:"CONTACTED",statuses:["NEW"]},
        {label:"Calificar",endpoint:"/api/v1/admin/leads",nextStatus:"QUALIFIED",statuses:["CONTACTED"]},
      ]} />
    </section>
  </PanelShell>;
}
