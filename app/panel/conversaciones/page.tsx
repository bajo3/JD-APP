import Link from "next/link";
import { getConversationQueue } from "@/lib/server/inbox-panel-data";
import { PanelAccessError, PanelAuthenticationRequired } from "@/lib/server/panel-auth";
import { ConversationAssignButton } from "../_components/ConversationAssignButton";
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

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

export default async function ConversacionesPage() {
  let data;
  try {
    data = await getConversationQueue();
  } catch (error) {
    // Layout y página se renderizan en paralelo. El layout resuelve la
    // redirección/estado protegido; evitar propagar aquí el mismo resultado
    // impide que un acceso anónimo esperado aparezca como error de runtime.
    if (error instanceof PanelAuthenticationRequired || error instanceof PanelAccessError) return null;
    throw error;
  }
  const { rows, waitingCount, lateCount } = data;
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
          <Link href="/panel/configuracion">Configurar canales</Link>
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
                  <div className="inbox-row">
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
                      {row.followUpAt ? (
                        <small className={row.followUpOverdue ? "is-overdue" : ""}>
                          Seguimiento: {dateTime.format(new Date(row.followUpAt))}
                        </small>
                      ) : null}
                    </Link>
                    {!row.assignedTo ? (
                      <ConversationAssignButton
                        conversationId={row.id}
                        contactName={row.contactName}
                        expectedVersion={row.version}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </PanelShell>
  );
}
