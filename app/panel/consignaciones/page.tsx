import { getAdminPanelData } from "@/lib/server/admin-panel-data";
import { AdminResourceForm } from "../_components/AdminResourceForm";
import { AdminTable } from "../_components/AdminTable";
import { DemoNotice } from "../_components/PanelCards";
import { PanelShell } from "../_components/PanelShell";

export default async function ConsignmentsPage() {
  const { overview, consignments } = await getAdminPanelData();
  const records = consignments.map((item) => ({id:item.id,label:item.vehicle,status:item.status,version:item.version}));
  return <PanelShell title="Consignación virtual" subtitle="Unidades ofrecidas por clientes: revisión, fotos privadas y decisión.">
    <DemoNotice isDemo={overview.isDemo} />
    <AdminResourceForm resource="consignment" records={records} />
    <section className="panel-card">
      <h2>Ofertas recibidas</h2>
      <p className="panel-muted">Aceptar habilita la unidad para ofrecerla; la publicación en stock sigue el circuito manual.</p>
      <AdminTable rows={consignments} columns={[{key:"name",label:"Lead"},{key:"vehicle",label:"Unidad",linkBase:"/panel/consignaciones/"},{key:"createdAt",label:"Recibida"},{key:"status",label:"Estado"}]} actions={[
        {label:"Iniciar revisión",endpoint:"/api/v1/admin/consignments",nextStatus:"IN_REVIEW",statuses:["SUBMITTED"]},
        {label:"Aceptar",endpoint:"/api/v1/admin/consignments",nextStatus:"ACCEPTED",statuses:["IN_REVIEW"]},
        {label:"Rechazar",endpoint:"/api/v1/admin/consignments",nextStatus:"REJECTED",statuses:["IN_REVIEW"]},
      ]} />
    </section>
  </PanelShell>;
}
