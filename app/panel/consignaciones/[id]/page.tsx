import Link from "next/link";
import { PanelShell } from "../../_components/PanelShell";
import { getAdminConsignmentDetailData } from "@/lib/server/admin-panel-data";

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
  SIDE: "Lateral",
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

export default async function ConsignmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { consignment, photos } = await getAdminConsignmentDetailData(id);

  return (
    <PanelShell
      title={`${consignment.vehicleDescription} ${consignment.year}`}
      subtitle="Consignación virtual: fotos privadas de la unidad y decisión comercial."
    >
      <Link className="panel-back-link" href="/panel/consignaciones">
        ← Volver a consignaciones
      </Link>

      <div className="lead-detail-grid">
        <section className="panel-card" aria-labelledby="consignment-data-title">
          <h2 id="consignment-data-title">Oferta</h2>
          <dl className="lead-detail-list">
            <Detail label="Estado" value={humanizeCode(consignment.status)} />
            <Detail label="Recibida" value={<Timestamp value={consignment.createdAt} />} />
            <Detail label="Actualizada" value={<Timestamp value={consignment.updatedAt} />} />
            <Detail label="Versión" value={`v${consignment.version}`} />
            <Detail label="Año" value={String(consignment.year)} />
            <Detail label="Kilómetros" value={consignment.mileageKm.toLocaleString("es-AR")} />
            <Detail
              label="Precio esperado por el dueño"
              value={
                consignment.askingPriceCents !== null
                  ? `${ars.format(consignment.askingPriceCents / 100)} (orientativo)`
                  : "No informado"
              }
            />
            {consignment.reviewedBy ? <Detail label="Revisada por" value={consignment.reviewedBy} /> : null}
            {consignment.decidedAt ? <Detail label="Decisión" value={<Timestamp value={consignment.decidedAt} />} /> : null}
          </dl>
          {consignment.ownerNotes ? (
            <p className="lead-disclaimer">Comentario del dueño: {consignment.ownerNotes}</p>
          ) : null}
          {consignment.notes ? <p className="lead-disclaimer">Notas internas: {consignment.notes}</p> : null}
        </section>

        <section className="panel-card" aria-labelledby="consignment-note-title">
          <h2 id="consignment-note-title">Cómo se ofrece</h2>
          <p className="panel-muted">
            Aceptar habilita la unidad para ofrecerla en consignación. La publicación en el
            catálogo público sigue el circuito manual de stock: exige precio final y condiciones
            acordadas con el dueño.
          </p>
        </section>
      </div>

      <section className="panel-card appraisal-photos-card" aria-labelledby="consignment-photos-title">
        <h2 id="consignment-photos-title">Fotos de la unidad</h2>
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
                  alt={`${CAPTURE_LABELS[photo.captureType] ?? photo.captureType} de la unidad`}
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
          <p className="admin-empty">El cliente no subió fotos para esta consignación.</p>
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
