import { PanelShell } from "../../_components/PanelShell";
import { MarketAppraisalForm } from "./MarketAppraisalForm";

export default function MarketReferencePage() {
  return (
    <PanelShell
      title="Referencia de mercado"
      subtitle="Asistente interno para contrastar precios publicados de vehículos similares."
    >
      <section className="panel-card">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">MERCADO LIBRE · REFERENCIA</p>
            <h2>Consultar precios publicados</h2>
          </div>
        </div>
        <p className="panel-muted">
          Esta herramienta genera una referencia de precios publicados para revisión del
          equipo. No es una tasación, no es una oferta de toma y no reemplaza la revisión
          humana.
        </p>
        <MarketAppraisalForm />
      </section>
    </PanelShell>
  );
}
