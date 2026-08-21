"use client";

import { CAPTURES, type PhotoSlot } from "./captures";

export function ContactFields(props: {
  name: string;
  phone: string;
  consent: boolean;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onConsent: (value: boolean) => void;
}) {
  return (
    <>
      <label>
        Nombre y apellido
        <input
          value={props.name}
          onChange={(event) => props.onName(event.target.value)}
          placeholder="Ej. Martín González"
        />
      </label>
      <label>
        Teléfono / WhatsApp
        <input
          value={props.phone}
          onChange={(event) => props.onPhone(event.target.value)}
          placeholder="249 458-7046"
        />
      </label>
      <label className="consent-check">
        <input
          type="checkbox"
          checked={props.consent}
          onChange={(event) => props.onConsent(event.target.checked)}
        />{" "}
        Acepto que me contacten por mi unidad.
      </label>
    </>
  );
}

export function VehicleFields() {
  return (
    <>
      <label>
        Marca
        <input name="make" placeholder="Toyota" />
      </label>
      <label>
        Modelo y versión
        <input name="model" placeholder="Corolla XEI" />
      </label>
      <label>
        Año
        <input name="year" type="number" placeholder="2022" />
      </label>
      <label>
        Kilómetros
        <input name="km" type="number" placeholder="48000" />
      </label>
      <label>
        Estado
        <select name="condition" defaultValue="GOOD">
          <option value="EXCELLENT">Excelente</option>
          <option value="GOOD">Bueno</option>
          <option value="FAIR">Regular</option>
          <option value="NEEDS_REPAIR">Necesita reparaciones</option>
        </select>
      </label>
      <label>
        Precio que esperás (opcional)
        <input name="asking" placeholder="$12.000.000" />
      </label>
      <label>
        Observaciones (opcional)
        <textarea name="notes" rows={3} />
      </label>
    </>
  );
}

export function PhotoSlots(props: {
  slots: Record<string, PhotoSlot>;
  onPhoto: (captureType: string, file: File | undefined) => void;
}) {
  const doneCount = CAPTURES.filter(
    (capture) => props.slots[capture.type]?.status === "done",
  ).length;
  return (
    <section className="photo-slots">
      <p className="photo-slots-intro">
        Sacá las cinco fotos guiadas de tu unidad ({doneCount} de {CAPTURES.length} listas). Se
        guardan sin datos de ubicación y sólo las ve el equipo de Jesús Díaz.
      </p>
      <ul>
        {CAPTURES.map((capture) => {
          const slot = props.slots[capture.type] ?? { status: "idle" as const };
          return (
            <li key={capture.type} className={`photo-slot is-${slot.status}`}>
              <span>{capture.label}</span>
              <small className="photo-hint">{capture.hint}</small>
              {slot.previewUrl && (
                // Blob local de una foto que todavía no salió del dispositivo:
                // next/image no administra object URLs y el src es privado.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slot.previewUrl} alt={`Vista ${capture.label.toLowerCase()} de la unidad`} />
              )}
              {slot.status === "done" ? (
                <small>✓ Lista</small>
              ) : slot.status === "uploading" ? (
                <small>Subiendo…</small>
              ) : slot.status === "error" ? (
                <small role="alert">{slot.message}</small>
              ) : null}
              <input
                type="file"
                accept="image/*"
                aria-label={`Foto ${capture.label}`}
                disabled={slot.status === "uploading" || slot.status === "done"}
                onChange={(event) => props.onPhoto(capture.type, event.target.files?.[0])}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
