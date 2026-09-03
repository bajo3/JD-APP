import Link from "next/link";
import { getConversationQueue } from "@/lib/server/inbox-panel-data";
import { PanelShell } from "../_components/PanelShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PLATFORM_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  telegram: "Telegram",
  sms: "SMS",
};

const SLA_LABEL: Record<string, string> = {
  answered: "Contestada",
  recent: "Recién llegó",
  soon: "Atender pronto",
  late: "Sin atender",
};

export default async function ConversacionesPage() {
  const { rows, waitingCount, lateCount } = await getConversationQueue();
  return (
    <PanelShell
      title="Conversaciones"
      subtitle="WhatsApp, Instagram y Messenger en una sola bandeja."
    >
      <section className="panel-card" aria-labelledby="inbox-title">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">BANDEJA UNIFICADA</p>
            <h2 id="inbox-title">Conversaciones abiertas</h2>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="panel-muted">Todavía no hay conversaciones abiertas.</p>
        ) : (
          <>
            <p className="panel-muted">
              {rows.length} {rows.length === 1 ? "conversación abierta" : "conversaciones abiertas"}.{" "}
              {waitingCount} esperando respuesta{lateCount > 0 ? `, ${lateCount} sin atender` : ""}.
            </p>
            <ol className="demand-matches inbox-queue">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link className="inbox-row-link" href={`/panel/conversaciones/${row.id}`}>
                    <div className="demand-match-head">
                      <span>{row.contactName}</span>
                      <small>{PLATFORM_LABEL[row.platform] ?? row.platform} · {row.accountName}</small>
                      <span className={`lead-validity${row.sla === "late" ? " is-expired" : ""}`}>
                        {SLA_LABEL[row.sla]}
                        {row.waitingMinutes !== null ? ` · ${row.waitingMinutes} min` : ""}
                      </span>
                    </div>
                    {row.lastMessagePreview ? <p className="panel-muted">{row.lastMessagePreview}</p> : null}
                    <small>
                      {row.handling === "AI" ? "Atiende el asesor" : "Atención humana"}
                      {row.assignedTo ? ` · Asignada a ${row.assignedTo}` : " · Sin asignar"}
                    </small>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </PanelShell>
  );
}
