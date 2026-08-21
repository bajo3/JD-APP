import Link from "next/link";
import { PanelShell } from "../../_components/PanelShell";
import { getAdminAppraisalDetailData } from "@/lib/server/admin-panel-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

const dateTime = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires",
  dateStyle: "short",
  timeStyle: "short",
});

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const CAPTURE_LABELS: Readonly<Record<string, string>> = {
  FRONT: "Frente",
  REAR: "Atrás",
  SIDE_LEFT: "Lateral izquierdo",
  SIDE_RIGHT: "Lateral derecho",
  INTERIOR: "Interior",
  DASHBOARD: "Tablero",
};

function humanizeCode(value: string): string {
  const parts = value.split("_").filter(Boolean);
  if (!parts.length) return value;
  return parts
    .map((part) => `${part.charAt(0)}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export default async function AppraisalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { appraisal, photos } = await getAdminAppraisalDetailData(id);

  return (
    <PanelShell title={appraisal.vehicleDescription} subtitle="Fotos privadas del usado y estado de revisión.">
      <Link className="panel-back-link" href="/panel/tasaciones">
        ← Volver a tasaciones
      </Link>

      <div className="lead-detail-grid">
        <section className="panel-card" aria-labelledby="appraisal-data-title">
          <h2 id="appraisal-data-title">Solicitud</h2>
          <dl className="lead-detail-list">
            <Detail label="Estado" value={humanizeCode(appraisal.status)} />
            <Detail label="Certeza" value={appraisal.certaintyLevel ?? "Sin definir"} />
            <Detail label="Recibida" value={<Timestamp value={appraisal.createdAt} />} />
            <Detail label="Actualizada" value={<Timestamp value={appraisal.updatedAt} />} />
            <Detail label="Versión" value={`v${appraisal.version}`} />
            <Detail label="Vigencia" value={appraisal.validUntil ? <Timestamp value={appraisal.validUntil} /> : "Sin vencimiento"} />
          </dl>
          {appraisal.notes ? <p className="lead-disclaimer">{appraisal.notes}</p> : null}
        </section>

        <section className="panel-card" aria-labelledby="appraisal-range-title">
          <h2 id="appraisal-range-title">Rango estimado</h2>
          {appraisal.baseCents !== null ? (
            <dl className="operation-amounts" aria-label="Rango de tasación">
              <Detail label="Conservador" value={appraisal.lowCents !== null ? ars.format(appraisal.lowCents / 100) : "—"} />
              <Detail label="Probable" value={ars.format(appraisal.baseCents / 100)} />
              <Detail label="Favorable" value={appraisal.highCents !== null ? ars.format(appraisal.highCents / 100) : "—"} />
            </dl>
          ) : (
            <p className="admin-empty">Todavía no hay un rango cargado para esta tasación.</p>
          )}
        </section>
      </div>

      <section className="panel-card appraisal-photos-card" aria-labelledby="appraisal-photos-title">
        <h2 id="appraisal-photos-title">Fotos del usado</h2>
        <p className="appraisal-photos-note">
          Imágenes privadas entregadas solo dentro del panel. Se guardan sin metadatos.
        </p>
        {photos.length ? (
          <ul className="appraisal-photo-grid">
            {photos.map((photo) => (
              <li key={photo.id}>
                {/* Bytes privados servidos por una API autenticada con no-store:
                    next/image no puede optimizarlos ni cachearlos sin exponerlos. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={`${CAPTURE_LABELS[photo.captureType] ?? photo.captureType} del usado`}
                  loading="lazy"
                />
                <span>{CAPTURE_LABELS[photo.captureType] ?? humanizeCode(photo.captureType)}</span>
                <small>
                  {(photo.byteSize / 1024).toFixed(0)} KiB · <Timestamp value={photo.uploadedAt} />
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">El cliente no subió fotos para esta tasación.</p>
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
