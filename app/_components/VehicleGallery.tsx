import Image from "next/image";
import type { PublicVehicleImage } from "@/lib/server/public-data";

/**
 * Galería de la ficha. No usa estado de cliente: el carril es un contenedor con
 * scroll-snap y las miniaturas son anclas al slide, así que funciona con el
 * service worker sin conexión, con teclado y sin JavaScript.
 */
export function VehicleGallery({
  images,
  tone,
  type,
  slug,
}: {
  images: readonly PublicVehicleImage[];
  tone: string;
  type: string;
  slug: string;
}) {
  const slideId = (index: number) => `foto-${slug}-${index + 1}`;
  return (
    <div className="detail-gallery">
      {/* Un carril con scroll propio tiene que poder recibir foco para recorrerse
          con el teclado (WCAG 2.1.1); por eso lleva tabIndex sin ser un control. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <ul className={`gallery-track ${tone}`} tabIndex={0} role="region" aria-label={`Fotos de la unidad (${images.length})`}>
        {images.map((image, index) => (
          <li key={image.url} id={slideId(index)}>
            {index === 0 ? <span className="gallery-type">{type}</span> : null}
            <Image
              className="gallery-photo"
              src={image.url}
              alt={image.alt}
              width={image.width}
              height={image.height}
              unoptimized
              priority={index === 0}
            />
            <span className="gallery-counter">{index + 1}/{images.length}</span>
          </li>
        ))}
      </ul>
      {images.length > 1 ? (
        <ul className="gallery-thumbs">
          {images.map((image, index) => (
            <li key={image.url}>
              <a href={`#${slideId(index)}`} aria-label={`Ver foto ${index + 1} de ${images.length}`}>
                <Image src={image.url} alt="" width={96} height={72} unoptimized aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
