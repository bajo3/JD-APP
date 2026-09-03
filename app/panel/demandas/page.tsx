import { getDemandPanelData } from "@/lib/server/demand-panel-data";
import { PanelShell } from "../_components/PanelShell";

const fecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "medium",
});

export default async function DemandasPage() {
  const { map, openDemands, pending } = await getDemandPanelData();
  return <PanelShell title="Demanda" subtitle="Qué está buscando la gente y qué unidades coinciden.">
    <section className="panel-card" aria-labelledby="mapa-title">
      <p className="panel-kicker">MAPA DE DEMANDA</p>
      <h2 id="mapa-title">Qué busca la gente hoy</h2>
      {map.vacio ? (
        <p className="panel-muted">Todavía no hay demandas registradas y vigentes.</p>
      ) : (
        <>
          <p className="panel-muted">
            {map.totalDemandas} demandas abiertas y vigentes. {map.conPermuta} entregarían un
            vehículo como parte de pago y {map.listasEnSieteDias} declararon que compran dentro de
            siete días.
          </p>
          <ul className="demand-buckets">
            {map.porPresupuesto.map((row) => (
              <li key={row.etiqueta}>
                <strong>{row.personas}</strong>
                <span>buscan {row.etiqueta}</span>
              </li>
            ))}
            {map.porTipo.map((row) => (
              <li key={`tipo-${row.etiqueta}`}>
                <strong>{row.personas}</strong>
                <span>aceptarían {row.etiqueta}</span>
              </li>
            ))}
          </ul>
          <p className="panel-muted">
            <strong>Sin declarar:</strong> {map.noDeclarado.presupuesto} sin presupuesto y{" "}
            {map.noDeclarado.urgencia} sin plazo de compra. No se estiman: nadie los dijo.
          </p>
        </>
      )}
    </section>

    <section className="panel-card" aria-labelledby="coincidencias-title">
      <h2 id="coincidencias-title">Coincidencias por avisar</h2>
      <p className="panel-muted">
        El sistema prepara el mensaje; lo manda una persona. Ninguna de estas coincidencias salió
        todavía al cliente.
      </p>
      {pending.length === 0 ? (
        <p className="panel-muted">No hay coincidencias pendientes.</p>
      ) : (
        <ol className="demand-matches">
          {pending.map((match) => (
            <li key={match.matchId}>
              <div className="demand-match-head">
                <strong>{match.scorePercent}%</strong>
                <span>{match.vehicle}</span>
                <small>
                  {match.buyer} · {match.demandCode} ·{" "}
                  {match.assignedTo ?? "sin vendedor asignado"}
                </small>
              </div>
              <p className="panel-muted">Cumple: {match.cumple.join(", ") || "nada declarado"}</p>
              {match.noCumple.length > 0 && (
                <p className="panel-muted">No cumple: {match.noCumple.join(" · ")}</p>
              )}
              <p className="demand-draft">{match.draft}</p>
            </li>
          ))}
        </ol>
      )}
    </section>

    <section className="panel-card" aria-labelledby="demandas-title">
      <h2 id="demandas-title">Demandas abiertas</h2>
      {openDemands.length === 0 ? (
        <p className="panel-muted">No hay demandas vigentes.</p>
      ) : (
        <ul className="demand-list">
          {openDemands.map((demand) => (
            <li key={demand.id}>
              <strong>{demand.buyer}</strong>
              <span>{demand.resumen}</span>
              <small>
                {demand.code} · vence el {fecha.format(new Date(demand.validUntil))} ·{" "}
                {demand.assignedTo ?? "sin vendedor asignado"}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  </PanelShell>;
}
