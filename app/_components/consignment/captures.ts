export type CaptureType = "FRONT" | "REAR" | "SIDE" | "INTERIOR" | "DASHBOARD";

export type CaptureDefinition = Readonly<{
  type: CaptureType;
  label: string;
  hint: string;
}>;

export const CAPTURES: readonly CaptureDefinition[] = [
  { type: "FRONT", label: "Frente", hint: "De frente, unidad completa" },
  { type: "REAR", label: "Atrás", hint: "Desde atrás, unidad completa" },
  { type: "SIDE", label: "Lateral", hint: "De costado, unidad completa" },
  { type: "INTERIOR", label: "Interior", hint: "Asientos y tapizados" },
  { type: "DASHBOARD", label: "Tablero", hint: "Tablero con kilómetros visibles" },
] as const;

export type SlotStatus = "idle" | "uploading" | "done" | "error";

export type PhotoSlot = Readonly<{
  status: SlotStatus;
  previewUrl?: string;
  message?: string;
}>;

export const initialSlots = (): Record<CaptureType, PhotoSlot> =>
  Object.fromEntries(
    CAPTURES.map((capture) => [capture.type, { status: "idle" } as PhotoSlot]),
  ) as Record<CaptureType, PhotoSlot>;
