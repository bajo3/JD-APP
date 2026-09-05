"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MEDIA_IMAGE_BYTES } from "@/lib/media/policy.mjs";

type Vehicle = { id: string; name: string; version: number };
type Media = {
  id: string;
  url: string | null;
  altText: string;
  sortOrder: number;
  version: number;
  status: "PENDING" | "READY" | "ARCHIVED" | "FAILED";
};

export function VehicleMediaManager({ vehicles }: { vehicles: Vehicle[] }) {
  const initialVehicle = vehicles[0];
  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? "");
  const [vehicleVersion, setVehicleVersion] = useState(initialVehicle?.version ?? 1);
  const [items, setItems] = useState<Media[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState(defaultAlt(initialVehicle));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const uploadKeyRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vehicle = vehicles.find((item) => item.id === vehicleId);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/admin/vehicles/${vehicleId}/media`);
      if (!response.ok) throw new Error("No se pudieron cargar las fotos.");
      const body = (await response.json()) as { data?: Media[] };
      const currentVersion = Number(response.headers.get("X-Vehicle-Version"));
      if (Number.isSafeInteger(currentVersion) && currentVersion > 0) {
        setVehicleVersion(currentVersion);
      }
      setItems(body.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    // The effect synchronizes the selected vehicle with the protected media API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function selectVehicle(nextId: string) {
    const nextVehicle = vehicles.find((item) => item.id === nextId);
    setVehicleId(nextId);
    setVehicleVersion(nextVehicle?.version ?? 1);
    setItems([]);
    setFile(null);
    setAltText(defaultAlt(nextVehicle));
    setMessage("");
    uploadKeyRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setMessage("");
    uploadKeyRef.current = null;
  }

  async function upload() {
    if (!file || !vehicle) return;
    if (file.size > MAX_MEDIA_IMAGE_BYTES) {
      setMessage("La foto supera el máximo de 4 MiB.");
      return;
    }
    if (altText.trim().length < 3) {
      setMessage("Describí la foto con al menos 3 caracteres.");
      return;
    }
    setLoading(true);
    setMessage("Subiendo…");
    const idempotencyKey = uploadKeyRef.current ?? crypto.randomUUID();
    uploadKeyRef.current = idempotencyKey;
    try {
      const response = await fetch(`/api/v1/admin/vehicles/${vehicle.id}/media`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "Idempotency-Key": idempotencyKey,
          "X-Vehicle-Version": String(vehicleVersion),
          "X-Alt-Text": altText.trim(),
        },
        body: file,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "El stock cambió. Recargá las fotos antes de reintentar."
            : "No se pudo subir la foto.",
        );
      }
      setMessage("Foto cargada correctamente.");
      uploadKeyRef.current = null;
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function mutate(mediaId: string, body: Record<string, unknown>) {
    setLoading(true);
    setMessage("Guardando…");
    try {
      const response = await fetch(`/api/v1/admin/vehicles/${vehicleId}/media/${mediaId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Vehicle-Version": String(vehicleVersion),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "El stock cambió. Recargá las fotos antes de continuar."
            : "No se pudo actualizar la foto.",
        );
      }
      setMessage("Cambio guardado.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  function reorder(mediaId: string, direction: -1 | 1) {
    const ready = items.filter((item) => item.status === "READY");
    const currentIndex = ready.findIndex((item) => item.id === mediaId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ready.length) return;
    const orderedMediaIds = ready.map((item) => item.id);
    [orderedMediaIds[currentIndex], orderedMediaIds[nextIndex]] = [
      orderedMediaIds[nextIndex],
      orderedMediaIds[currentIndex],
    ];
    void mutate(mediaId, { action: "reorder", orderedMediaIds });
  }

  const readyItems = items.filter((item) => item.status === "READY");
  const primaryId = readyItems[0]?.id;

  return (
    <section className="panel-card media-manager">
      <div className="panel-card-head">
        <div>
          <p className="panel-kicker">FOTOS DE STOCK</p>
          <h2>Medios del vehículo</h2>
        </div>
      </div>

      <label className="admin-search">
        Vehículo
        <select value={vehicleId} onChange={(event) => selectVehicle(event.target.value)}>
          {vehicles.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <div className="media-upload">
        <label>
          Seleccionar imagen
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            disabled={!vehicle || loading}
          />
        </label>
        <label>
          Descripción accesible
          <input
            type="text"
            value={altText}
            maxLength={240}
            onChange={(event) => {
              setAltText(event.target.value);
              uploadKeyRef.current = null;
            }}
            disabled={!vehicle || loading}
          />
        </label>
        <small>JPEG, PNG, WebP o AVIF · máximo 4 MiB</small>
        <button
          type="button"
          className="panel-action"
          onClick={() => void upload()}
          disabled={!file || !vehicle || loading}
        >
          {loading ? "Procesando…" : "Subir foto"}
        </button>
      </div>

      {message ? <p className="admin-feedback" role="status" aria-live="polite">{message}</p> : null}
      {loading && items.length === 0 ? (
        <p className="admin-empty">Cargando fotos…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">Este vehículo todavía no tiene fotos.</p>
      ) : (
        <div className="media-grid">
          {items.map((media) => {
            const readyIndex = readyItems.findIndex((item) => item.id === media.id);
            return (
              <article className="media-item" key={media.id}>
                {media.status === "READY" && media.url ? (
                  <Image
                    src={media.url}
                    alt={media.altText}
                    width={360}
                    height={240}
                    unoptimized
                  />
                ) : (
                  <div className="media-placeholder" aria-label={`Foto ${media.status.toLowerCase()}`}>
                    {media.status}
                  </div>
                )}
                <div>
                  <strong>{media.id === primaryId ? "Principal" : "Secundaria"}</strong>
                  <small>Orden {media.sortOrder} · {media.status}</small>
                  <small>{media.altText}</small>
                </div>
                {media.status === "READY" ? (
                  <div className="media-actions">
                    <button
                      type="button"
                      className="panel-action"
                      disabled={loading || media.id === primaryId}
                      onClick={() => void mutate(media.id, { action: "set_primary" })}
                    >
                      Principal
                    </button>
                    <button
                      type="button"
                      className="panel-action"
                      aria-label={`Mover ${media.altText} hacia arriba`}
                      disabled={loading || readyIndex <= 0}
                      onClick={() => reorder(media.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="panel-action"
                      aria-label={`Mover ${media.altText} hacia abajo`}
                      disabled={loading || readyIndex === readyItems.length - 1}
                      onClick={() => reorder(media.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="panel-action"
                      disabled={loading}
                      onClick={() => {
                        if (window.confirm("¿Archivar esta foto?")) {
                          void mutate(media.id, { action: "archive" });
                        }
                      }}
                    >
                      Archivar
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function defaultAlt(vehicle: Vehicle | undefined): string {
  return vehicle ? `${vehicle.name} - vista del vehículo` : "";
}
