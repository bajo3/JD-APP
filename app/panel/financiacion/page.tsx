import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function FinancePage() {
  const { overview, financePlans } = await getAdminPanelData();
  return <PanelShell title="Financiación" subtitle="Versiones auditadas de tarifarios y tramos.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="finance" />
    <section className="panel-card">
      <h2>Planes cargados</h2>
      <AdminTable rows={financePlans} columns={[{key:"name",label:"Nombre"},{key:"provider",label:"Proveedor"},{key:"status",label:"Estado"},{key:"isDemo",label:"Demo"}]} actions={[
        {label:"Publicar",endpoint:"/api/v1/admin/finance-plans",action:"publish",statuses:["DRAFT"]},
        {label:"Retirar",endpoint:"/api/v1/admin/finance-plans",action:"retire",statuses:["PUBLISHED"]},
      ]} />
    </section>
  </PanelShell>;
}
