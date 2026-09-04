import { notFound } from "next/navigation";
import Link from "next/link";
import { getConversationThread } from "@/lib/server/inbox-panel-data";
import { PanelShell } from "../../_components/PanelShell";
import { ConversationReplyForm } from "../../_components/ConversationReplyForm";
import { ConversationWorkflowForm } from "../../_components/ConversationWorkflowForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ConversationDetailPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

const AUTHOR_LABEL: Record<string, string> = {
  CUSTOMER: "Cliente",
  AI: "Asesor",
  SELLER: "Vendedor",
};

export default async function ConversationDetailPage({ params }: ConversationDetailPageProps) {
  const { id } = await params;
  const { conversation, messages } = await getConversationThread(id);
  if (!conversation) notFound();

  return (
    <PanelShell title={conversation.contactName} subtitle="Hilo de la conversación y respuesta manual.">
      <Link className="panel-back-link" href="/panel/conversaciones">
        ← Volver a conversaciones
      </Link>

      <section className="panel-card" aria-labelledby="thread-title">
        <div className="panel-card-head">
          <div>
            <p className="panel-kicker">
              {conversation.platform.toUpperCase()} · {conversation.accountName}
            </p>
            <h2 id="thread-title">
              {conversation.contactName}
              {conversation.contactPhone ? <small> · {conversation.contactPhone}</small> : null}
            </h2>
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="panel-muted">Todavía no hay mensajes en esta conversación.</p>
        ) : (
          <ol className="lead-event-list inbox-thread">
            {messages.map((message, index) => (
              <li key={index} className={message.direction === "incoming" ? "inbox-incoming" : "inbox-outgoing"}>
                <strong>{message.direction === "incoming" ? conversation.contactName : AUTHOR_LABEL[message.authorType] ?? message.authorType}</strong>
                <time dateTime={message.occurredAt}>{dateTime.format(new Date(message.occurredAt))}</time>
                <small>{message.text ?? "(sin texto)"}</small>
              </li>
            ))}
          </ol>
        )}

        <ConversationReplyForm conversationId={conversation.id} handling={conversation.handling} />
      </section>

      <ConversationWorkflowForm
        conversationId={conversation.id}
        expectedVersion={conversation.version}
        assignedTo={conversation.assignedTo}
        followUpAt={conversation.followUpAt}
        followUpNote={conversation.followUpNote}
        hasLead={conversation.leadId !== null}
      />
    </PanelShell>
  );
}
