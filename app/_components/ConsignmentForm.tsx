"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CAPTURES, initialSlots, type CaptureType, type PhotoSlot } from "./consignment/captures";
import { ContactFields, VehicleFields, PhotoSlots } from "./consignment/FormSteps";
import {
  createConsignmentOffer,
  parseMoneyToCents,
  uploadConsignmentPhoto,
} from "./consignment/photo-client";

/**
 * Las claves de idempotencia viven en refs: un reintento del mismo intento
 * (alta o captura) reutiliza exactamente la misma clave, y sólo un cambio de
 * archivo genera una clave nueva. Así el servidor reanuda en vez de duplicar.
 */
export function ConsignmentForm() {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<React.ReactNode>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [offer, setOffer] = useState<{ code: string; uploadToken: string } | null>(null);
  const [slots, setSlots] = useState<Record<CaptureType, PhotoSlot>>(initialSlots);

  const creationKeyRef = useRef<string | null>(null);
  const slotKeysRef = useRef<Partial<Record<CaptureType, string>>>({});
  const slotFilesRef = useRef<Partial<Record<CaptureType, File>>>({});

  useEffect(() => {
    const current = slots;
    return () => {
      for (const slot of Object.values(current)) {
        if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
      }
    };
  }, [slots]);

  const doneCount = CAPTURES.filter((capture) => slots[capture.type].status === "done").length;

  const patchSlot = (type: CaptureType, patch: Partial<PhotoSlot>) => {
    setSlots((previous) => ({ ...previous, [type]: { ...previous[type], ...patch } }));
  };

  const replacePreview = (type: CaptureType, file: File) => {
    const previousUrl = slots[type].previewUrl;
    const previewUrl = URL.createObjectURL(file);
    patchSlot(type, { previewUrl });
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  };

  const slotKey = (type: CaptureType, file: File): string => {
    if (slotFilesRef.current[type] !== file) {
      slotKeysRef.current[type] = crypto.randomUUID();
      slotFilesRef.current[type] = file;
    }
    return slotKeysRef.current[type] ?? crypto.randomUUID();
  };

  const onPhoto = async (captureType: string, file: File | undefined) => {
    const type = captureType as CaptureType;
    if (!file || !offer) return;
    patchSlot(type, { status: "uploading", message: undefined });
    try {
      await uploadConsignmentPhoto({
        code: offer.code,
        uploadToken: offer.uploadToken,
        idempotencyKey: slotKey(type, file),
        captureType,
        file,
      });
      replacePreview(type, file);
      patchSlot(type, { status: "done", message: undefined });
    } catch (caught) {
      patchSlot(type, {
        status: "error",
        message: caught instanceof Error ? caught.message : "No pudimos subir la foto.",
      });
    }
  };

  const submitContactStep = (): boolean => {
    if (!name.trim() || !phone.trim() || !consent) {
      setError("Completá nombre, teléfono y consentimiento para continuar.");
      return false;
    }
    setError("");
    setStep(2);
    return true;
  };

  const submitVehicleStep = async (form: FormData): Promise<void> => {
    const make = String(form.get("make") ?? "").trim();
    const model = String(form.get("model") ?? "").trim();
    const year = form.get("year");
    const km = form.get("km");
    if (!make || !model || !year || !km) {
      setError("Completá marca, modelo, año y kilómetros de la unidad.");
      return;
    }
    setBusy(true);
    try {
      const askingCents = parseMoneyToCents(String(form.get("asking") ?? ""));
      const notes = String(form.get("notes") ?? "").trim();
      creationKeyRef.current ??= crypto.randomUUID();
      const created = await createConsignmentOffer({
        idempotencyKey: creationKeyRef.current,
        name: name.trim(),
        phone: phone.trim(),
        vehicle: {
          make,
          model,
          trim: String(form.get("trim") ?? ""),
          year: Number(year),
          mileageKm: Number(km),
          declaredCondition: String(form.get("condition")),
          ...(askingCents > 0 ? { askingPriceCents: askingCents } : {}),
          ...(notes ? { ownerNotes: notes } : {}),
        },
      });
      setOffer(created);
      setError("");
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ocurrió un error. Intentá nuevamente.");
    } finally {
      setBusy(false);
    }
  };

  const finishPhotoStep = (): void => {
    setResult(
      <div className="form-success">
        <span>✓</span>
        <h3>Oferta de consignación recibida</h3>
        <p>
          Código: <strong>{offer?.code}</strong>
        </p>
        <p className="finder-disclaimer">
          Un vendedor revisa las fotos y te contacta. Publicamos tu unidad sólo cuando la
          aceptemos y acordemos condiciones contigo.
        </p>
      </div>,
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 1) {
      submitContactStep();
      return;
    }
    if (step === 2) {
      await submitVehicleStep(new FormData(event.currentTarget));
      return;
    }
    if (doneCount === CAPTURES.length) finishPhotoStep();
  };

  if (result) return result;

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="form-steps">
        <span className={step === 1 ? "active" : ""}>01 Contacto</span>
        <span className={step === 2 ? "active" : ""}>02 Unidad</span>
        <span className={step === 3 ? "active" : ""}>03 Fotos</span>
      </div>
      {step === 3 ? (
        <PhotoSlots slots={slots} onPhoto={onPhoto} />
      ) : (
        <>
          <ContactFields
            name={name}
            phone={phone}
            consent={consent}
            onName={setName}
            onPhone={setPhone}
            onConsent={setConsent}
          />
          {step === 2 && <VehicleFields />}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {step === 3 && doneCount < CAPTURES.length && (
        <p className="finder-disclaimer" role="status">
          Subí las cinco fotos para finalizar. No recargues la página: si perdés el código
          tenés que empezar de nuevo.
        </p>
      )}
      <button
        className="primary-button"
        disabled={busy || (step === 3 && doneCount < CAPTURES.length)}
      >
        {busy
          ? "Enviando…"
          : step === 1 || step === 2
            ? "Continuar"
            : `Finalizar (${doneCount}/${CAPTURES.length})`}
        <span>→</span>
      </button>
    </form>
  );
}
