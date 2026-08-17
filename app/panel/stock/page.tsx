import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function PanelStockPage() {
  const { overview, vehicles } = await getAdminPanelData();
  return <PanelShell title="Stock" subtitle="Disponibilidad, publicación y precios vigentes.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="vehicle" />
    <section className="panel-card">
      <h2>Vehículos</h2>
      <AdminTable rows={vehicles} columns={[{key:"name",label:"Vehículo"},{key:"year",label:"Año"},{key:"price",label:"Precio"},{key:"status",label:"Estado"}]} actions={[
        {label:"Publicar",endpoint:"/api/v1/admin/vehicles",nextStatus:"AVAILABLE",statuses:["DRAFT"]},
        {label:"Pausar",endpoint:"/api/v1/admin/vehicles",nextStatus:"PAUSED",statuses:["AVAILABLE"]},
        {label:"Archivar",endpoint:"/api/v1/admin/vehicles",action:"archive",statuses:["DRAFT","AVAILABLE","RESERVED","SOLD","PAUSED"]},
      ]} />
    </section>
  </PanelShell>;
}
