import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function OffersPage() {
  const { overview, offers } = await getAdminPanelData();
  return <PanelShell title="Ofertas" subtitle="Promociones con ventana y condiciones controladas.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="promotion" />
    <section className="panel-card">
      <h2>Ofertas</h2>
      <AdminTable rows={offers} columns={[{key:"title",label:"Oferta"},{key:"vehicle",label:"Vehículo"},{key:"status",label:"Estado"}]} actions={[
        {label:"Programar",endpoint:"/api/v1/admin/promotions",action:"schedule",includeSchedule:true,statuses:["DRAFT"]},
        {label:"Activar",endpoint:"/api/v1/admin/promotions",action:"activate",statuses:["SCHEDULED"]},
        {label:"Pausar",endpoint:"/api/v1/admin/promotions",action:"pause",statuses:["ACTIVE"]},
        {label:"Vencer",endpoint:"/api/v1/admin/promotions",action:"expire",statuses:["ACTIVE"]},
        {label:"Archivar",endpoint:"/api/v1/admin/promotions",action:"archive",statuses:["ACTIVE"]},
      ]} />
    </section>
  </PanelShell>;
}
