import { AdminResourceForm } from "../../_components/AdminResourceForm";
import { AdminTable } from "../../_components/AdminTable";
import { PanelShell } from "../../_components/PanelShell";
import { getAppraisalRulesetPanelData } from "@/lib/server/admin-panel-data";

export default async function AppraisalReferencesPage() {
  const { rulesets } = await getAppraisalRulesetPanelData();
  return <PanelShell title="Referencias de tasación" subtitle="Versiones auditadas que habilitan rangos preliminares, nunca una toma confirmada.">
    <AdminResourceForm resource="appraisal-ruleset" />
    <section className="panel-card">
      <h2>Tarifarios cargados</h2>
      <p className="panel-muted">La publicación es irreversible: para corregir valores se carga una versión nueva.</p>
      <AdminTable rows={rulesets} columns={[
        { key: "commercialVersion", label: "Versión" },
        { key: "referenceCount", label: "Referencias" },
        { key: "validFrom", label: "Desde" },
        { key: "validUntil", label: "Hasta" },
        { key: "status", label: "Estado" },
      ]} actions={[
        { label: "Publicar", endpoint: "/api/v1/admin/appraisal-rulesets", action: "publish", statuses: ["DRAFT"] },
      ]} />
    </section>
  </PanelShell>;
}
