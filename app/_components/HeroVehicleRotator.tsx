"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export type HeroVehiclePhoto = { url: string; alt: string };

// La galería del hero es decorativa (el contenedor ya lleva aria-hidden):
// muestra fotos reales del stock publicado rotando cada pocos segundos, en
// vez de la ilustración genérica. Si no hay ninguna foto real todavía
// (catálogo vacío), no rota nada — llamalo sólo con `photos.length > 0`.
export function HeroVehicleRotator({ photos }: { photos: readonly HeroVehiclePhoto[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (photos.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % photos.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [photos.length]);

  return (
    <div className="hero-photo-rotator">
      {photos.map((photo, position) => (
        <Image
          key={photo.url}
          className={`hero-photo${position === index ? " is-active" : ""}`}
          src={photo.url}
          alt={photo.alt}
          width={520}
          height={340}
          unoptimized
          priority={position === 0}
        />
      ))}
    </div>
  );
}
