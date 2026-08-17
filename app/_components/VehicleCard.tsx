export type Vehicle = {
  slug: string;
  type: string;
  name: string;
  year: string;
  km: string;
  price: string;
  tone: string;
  availabilityLabel?: string;
  updatedLabel?: string;
  demo?: boolean;
};
export function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <article className="vehicle-card">
      <a href={`/autos/${vehicle.slug}`}>
        <div className={`vehicle-image ${vehicle.tone}`}>
          <span>{vehicle.type}</span>
          <div className="small-car" aria-hidden="true"><i/><i/></div>
        </div>
        <div className="vehicle-info">
          <p>{vehicle.year} · {vehicle.km}</p>
          <h3>{vehicle.name}</h3>
          <strong>{vehicle.price}</strong>
          <span className="card-link">Ver detalle <span>↗</span></span>
          {vehicle.availabilityLabel ? <p>{vehicle.availabilityLabel}</p> : null}
          {vehicle.updatedLabel ? (
            <p>{vehicle.demo ? "Dato demo · " : ""}{vehicle.updatedLabel}</p>
          ) : null}
        </div>
      </a>
    </article>
  );
}
