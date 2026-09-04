import Link from "next/link";
import { PanelShell } from "../../_components/PanelShell";
import { getAdminLeadDetailData } from "@/lib/server/admin-panel-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LeadDetailPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

type LeadEvent = Readonly<{
  id: string;
  type: string;
  occurredAt: string;
  actorType: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params;
  const { lead } = await getAdminLeadDetailData(id);
  const operation = lead.operation;

  return (
    <PanelShell
      title={lead.name}
      subtitle="Contexto comercial persistido para continuar la operación."
    >
      <Link className="panel-back-link" href="/panel/leads">
        ← Volver a leads
      </Link>

      <div className="lead-detail-grid">
        <section className="panel-card" aria-labelledby="lead-contact-title">
          <h2 id="lead-contact-title">Cliente</h2>
          <dl className="lead-detail-list">
            <Detail label="Nombre" value={lead.name} />
            <Detail
              label="Teléfono"
              value={<a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a>}
            />
            <Detail label="Estado" value={humanizeCode(lead.status)} />
            <Detail label="Responsable" value={lead.assignedTo ?? "Sin asignar"} />
            {lead.lostReason ? <Detail label="Motivo de pérdida" value={lead.lostReason} /> : null}
            <Detail label="Origen" value={humanizeCode(lead.source)} />
            <Detail label="Ingreso" value={<Timestamp value={lead.createdAt} />} />
            <Detail label="Actualizado" value={<Timestamp value={lead.updatedAt} />} />
          </dl>
        </section>

        <section className="panel-card" aria-labelledby="lead-operation-title">
          {operation ? (
            <>
              <div className="lead-operation-heading">
                <div>
                  <h2 id="lead-operation-title">Operación guardada</h2>
                  <p>
                    {operation.vehicle.label} · Código <strong>{operation.simulationCode}</strong>
                  </p>
                </div>
                <span className={`lead-validity${operation.validity === "EXPIRED" ? " is-expired" : ""}`}>
                  {operation.validity === "EXPIRED" ? "Vencida" : "Vigente"}
                </span>
              </div>

              <dl className="lead-detail-list">
                <Detail label="Estado de operación" value={humanizeCode(operation.status)} />
                <Detail label="Clasificación" value={humanizeCode(operation.classification)} />
                <Detail label="Certeza" value={operation.certaintyLevel} />
                <Detail label="Creada" value={<Timestamp value={operation.createdAt} />} />
                <Detail label="Vence" value={<Timestamp value={operation.expiresAt} />} />
              </dl>

              <dl className="operation-amounts" aria-label="Importes del snapshot">
                {operationAmountRows(operation.amounts, operation.termMonths).map((row) => (
                  <Detail key={row.label} label={row.label} value={row.value} />
                ))}
              </dl>

              <p className="lead-disclaimer">
                <strong>Condición congelada:</strong> {operation.disclaimer}
              </p>
              <Link className="context-secondary-link" href={`/autos/${operation.vehicle.slug}`}>
                Ver unidad pública <span>↗</span>
              </Link>
            </>
          ) : (
            <div className="admin-empty">
              <h2 id="lead-operation-title">Sin operación simulada</h2>
              <p>Este contacto todavía no tiene una unidad y simulación vinculadas.</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel-card lead-events-card" aria-labelledby="lead-events-title">
        <h2 id="lead-events-title">Actividad</h2>
        {lead.events.length ? (
          <ol className="lead-event-list">
            {lead.events.map((event: LeadEvent) => (
              <li key={event.id}>
                <strong>{eventLabel(event.type)}</strong>
                <Timestamp value={event.occurredAt} />
                <small>{eventSummary(event.actorType, event.metadata)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="admin-empty">Todavía no hay actividad registrada.</p>
        )}
      </section>
    </PanelShell>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Timestamp({ value }: { value: string }) {
  const parsed = new Date(value);
  return (
    <time dateTime={value}>
      {Number.isNaN(parsed.getTime()) ? "Fecha no informada" : dateTime.format(parsed)}
    </time>
  );
}

function operationAmountRows(
  amounts: {
    listedPriceCents: number;
    effectivePriceCents: number;
    appraisalAppliedCents: number;
    tradeInBonusCents: number;
    cashCents: number;
    financePrincipalCents: number;
    installmentCents: number | null;
    totalCostCents: number | null;
  },
  termMonths: number | null,
) {
  return [
    { label: "Precio publicado", value: formatCents(amounts.listedPriceCents) },
    { label: "Precio efectivo", value: formatCents(amounts.effectivePriceCents) },
    { label: "Usado aplicado", value: formatCents(amounts.appraisalAppliedCents) },
    { label: "Bonificación de toma", value: formatCents(amounts.tradeInBonusCents) },
    { label: "Efectivo", value: formatCents(amounts.cashCents) },
    { label: "Saldo financiado", value: formatCents(amounts.financePrincipalCents) },
    { label: "Plazo", value: termMonths ? `${termMonths} meses` : "Sin financiación" },
    { label: "Cuota", value: nullableCents(amounts.installmentCents) },
    { label: "Costo total", value: nullableCents(amounts.totalCostCents) },
  ];
}

function formatCents(value: number): string {
  return money.format(value / 100);
}

function nullableCents(value: number | null): string {
  return value === null ? "No aplica" : formatCents(value);
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    LEAD_CREATED: "Lead creado",
    SIMULATION_LINKED: "Simulación vinculada",
    WHATSAPP_HANDOFF_CREATED: "WhatsApp preparado",
    STATUS_CHANGED: "Estado actualizado",
    INBOX_ASSIGNED: "Conversación asignada",
    FOLLOW_UP_SCHEDULED: "Seguimiento programado",
    FOLLOW_UP_CLEARED: "Seguimiento retirado",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLocaleLowerCase("es-AR");
}

function humanizeCode(value: string): string {
  const normalized = value.replaceAll("_", " ").toLocaleLowerCase("es-AR");
  return normalized.charAt(0).toLocaleUpperCase("es-AR") + normalized.slice(1);
}

function eventSummary(actorType: string, metadata: Readonly<Record<string, unknown>>): string {
  const code = typeof metadata.handoffCode === "string" ? ` · ${metadata.handoffCode}` : "";
  const loss = typeof metadata.lostReason === "string" ? ` · Motivo: ${metadata.lostReason}` : "";
  const dueAt = typeof metadata.dueAt === "string" ? new Date(metadata.dueAt) : null;
  const due = dueAt && Number.isFinite(dueAt.getTime()) ? ` · Para ${dateTime.format(dueAt)}` : "";
  return `Actor: ${humanizeCode(actorType)}${code}${loss}${due}`;
}
