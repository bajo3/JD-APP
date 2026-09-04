"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Cierra la sesión en el servidor antes de soltar la pantalla privada. */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      className="context-secondary-link"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/v1/account/sessions", { method: "DELETE" });
        } finally {
          router.replace("/");
          router.refresh();
        }
      }}
    >
      {busy ? "Cerrando…" : "Cerrar sesión"} <span>↗</span>
    </button>
  );
}

/**
 * Marca la unidad como favorita. Sin sesión no falla en silencio: manda a
 * ingresar y vuelve a la misma ficha.
 */
export function FavoriteButton({
  vehicleId,
  slug,
  initiallySaved,
  signedIn,
}: {
  vehicleId: string;
  slug: string;
  initiallySaved: boolean;
  signedIn: boolean;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!signedIn) {
    return (
      <a
        className="favorite-button"
        href={`/cuenta/ingresar?volver=${encodeURIComponent(`/autos/${slug}`)}`}
      >
        ♡ Guardar en favoritos
      </a>
    );
  }

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      if (saved) {
        const response = await fetch(
          `/api/v1/account/favorites/${encodeURIComponent(vehicleId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("No pudimos quitarla de favoritos.");
        setSaved(false);
      } else {
        const response = await fetch("/api/v1/account/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleId }),
        });
        if (!response.ok) throw new Error("No pudimos guardarla en favoritos.");
        setSaved(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos guardar el cambio.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`favorite-button${saved ? " is-saved" : ""}`}
        aria-pressed={saved}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {saved ? "♥ Guardada en favoritos" : "♡ Guardar en favoritos"}
      </button>
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </>
  );
}
