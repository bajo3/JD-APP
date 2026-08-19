import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicShell } from "../../_components/PublicShell";
import { getDataAccess } from "@/lib/server/data-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Mi operación JD | Jesús Díaz Automotores",
  robots: { index: false, follow: false },
};

type PageProps = Readonly<{
  params: Promise<{ codigo: string }>;
}>;

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "long",
  timeStyle: "short",
});

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const CLASSIFICATION_LABELS: Readonly<Record<string, string>> = {
  REACHABLE_WITH_MARGIN: "Alcanzable con margen",
  REACHABLE_ESTIMATED: "Alcanzable estimado",
  NEARLY_REACHABLE: "Cerca de alcanzarlo",
  REQUIRES_EVALUATION: "Requiere evaluación",
  NOT_REACHABLE: "No alcanzable hoy",
};

const CERTAINTY_LABELS: Readonly<Record<string, string>> = {
  T0: "Orientativa (T0)",
  T1: "Preliminar (T1)",
  T2: "Revisada (T2)",
};

function humanizeCode(value: string): string {
  const parts = value.split("_").filter(Boolean);
  if (!parts.length) return value;
  return parts.map((part) => `${part.charAt(0)}${part.slice(1).toLowerCase()}`).join(" ");
}

async function loadSnapshot(codigo: string) {
  const normalized = decodeURIComponent(codigo).trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(normalized)) return null;
  const access = getDataAccess();
  const simulation = await access.simulations.findByPublicCode(normalized);
  if (!simulation) return null;
  const vehicle = (await access.stock.listAvailable()).find(
    (item) => item.id === simulation.vehicleId,
  );
  return {
    simulation,
    vehicle,
    expired: Date.parse(simulation.expiresAt) <= Date.now(),
  };
}

export default async function SimulationPage({ params }: PageProps) {
  const { codigo } = await params;
  const snapshot = await loadSnapshot(codigo);
  if (!snapshot) notFound();
  const { simulation, vehicle, expired } = snapshot;
  const cents = (value: number | null) => (value === null ? "—" : ars.format(value / 100));
  const vehicleLabel = vehicle
    ? `${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ""} ${vehicle.year}`.replace(/\s+/g, " ").trim()
    : null;

  return (
    <PublicShell>
      <main className="public-page form-page">
        <div className="form-intro">
          <p className="eyebrow">MI OPERACIÓN JD</p>
          <h1>{vehicleLabel ?? "Operación simulada"}</h1>
          <p>
            Snapshot preliminar de la operación guardada con el código{" "}
            <strong>{simulation.publicCode}</strong>. Es una estimación congelada: no es una
            aprobación ni una tasación definitiva.
          </p>
          <span className={`lead-validity${expired ? " is-expired" : ""}`}>
            {expired ? "Operación vencida" : "Vigente"}
          </span>
        </div>

        {expired ? (
          <div className="finder-context-message is-unavailable" role="status">
            Esta simulación venció el {dateTime.format(new Date(simulation.expiresAt))}. Los
            precios, la oferta y la financiación pueden haber cambiado: simulá nuevamente para
            obtener condiciones actuales.
          </div>
        ) : null}

        {!vehicle ? (
          <div className="finder-context-message is-unavailable" role="status">
            La unidad de esta operación ya no está publicada como disponible. Los importes siguen
            siendo los del snapshot guardado, pero la operación debe rehacerse sobre otra unidad.
          </div>
        ) : null}

        <section className="panel-card simulation-snapshot" aria-labelledby="simulation-amounts-title">
          <h2 id="simulation-amounts-title">Desglose de la operación</h2>
          <dl className="operation-amounts" aria-label="Importes del snapshot">
            <Detail label="Precio publicado" value={cents(simulation.vehiclePriceCents)} />
            <Detail label="Precio efectivo" value={cents(simulation.effectivePriceCents)} />
            <Detail label="Usado aplicado" value={cents(simulation.appraisalAppliedCents)} />
            <Detail label="Bonificación de toma" value={cents(simulation.tradeInBonusCents)} />
            <Detail label="Efectivo" value={cents(simulation.cashCents)} />
            <Detail label="Saldo financiado" value={cents(simulation.financePrincipalCents)} />
            <Detail label="Plazo" value={simulation.termMonths ? `${simulation.termMonths} meses` : "—"} />
            <Detail label="Cuota estimada" value={cents(simulation.installmentCents)} />
            <Detail label="Costo total" value={cents(simulation.totalCostCents)} />
          </dl>
          <dl className="lead-detail-list" aria-label="Condiciones del snapshot">
            <Detail label="Clasificación" value={CLASSIFICATION_LABELS[simulation.classification] ?? humanizeCode(simulation.classification)} />
            <Detail label="Certeza" value={CERTAINTY_LABELS[simulation.certaintyLevel] ?? simulation.certaintyLevel} />
            <Detail label="Creada" value={<time dateTime={simulation.createdAt}>{dateTime.format(new Date(simulation.createdAt))}</time>} />
            <Detail label="Vence" value={<time dateTime={simulation.expiresAt}>{dateTime.format(new Date(simulation.expiresAt))}</time>} />
          </dl>
          <p className="lead-disclaimer">
            <strong>Condición congelada:</strong> {simulation.disclaimerSnapshot}
          </p>
        </section>

        <div className="detail-actions">
          {vehicle ? (
            <Link className="context-secondary-link" href={`/autos/${vehicle.slug}`}>
              Ver la unidad <span>↗</span>
            </Link>
          ) : null}
          <Link className="context-secondary-link" href="/que-auto-me-llevo">
            Simular nuevamente <span>→</span>
          </Link>
        </div>
      </main>
    </PublicShell>
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
