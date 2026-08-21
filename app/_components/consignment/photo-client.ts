"use client";

const MAX_PHOTO_EDGE = 2048;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type ApiRecord = Record<string, unknown>;

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as ApiRecord;
  const error = body.error as ApiRecord | undefined;
  return typeof error?.message === "string" ? error.message : fallback;
}

export function parseMoneyToCents(value: string): number {
  const amount = Number(value.replace(/\D/g, "")) || 0;
  return amount > 0 ? amount * 100 : 0;
}

/**
 * Re-encodea a JPEG en el navegador: normaliza HEIC cuando el navegador puede
 * decodificarlo y borra metadatos antes de que la foto salga del dispositivo.
 * Si el canvas no está disponible, sólo pasa formatos ya sanitizables.
 */
async function reencodePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    });
    if (!blob) throw new Error("reencode_failed");
    return blob;
  } catch {
    if (/image\/(jpeg|png|webp)/.test(file.type) && file.size <= MAX_PHOTO_BYTES) {
      return file;
    }
    throw new Error("No pudimos procesar la imagen. Probá con una foto JPG o PNG.");
  }
}

export async function createConsignmentOffer(input: {
  idempotencyKey: string;
  name: string;
  phone: string;
  vehicle: ApiRecord;
}): Promise<{ code: string; uploadToken: string }> {
  const response = await fetch("/api/v1/consignments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      name: input.name,
      phone: input.phone,
      contactConsent: true,
      vehicle: input.vehicle,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as ApiRecord;
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "No pudimos procesar la consulta."));
  }
  const data = body.data as ApiRecord | undefined;
  const code = String(data?.code ?? "");
  const uploadToken = String(data?.uploadToken ?? "");
  if (!code || !uploadToken) {
    // Sin token no hay forma honesta de continuar: el alta ya existe y la
    // respuesta de replay no lo vuelve a entregar.
    throw new Error(
      "La oferta ya estaba registrada. Recargá la página y empezá de nuevo con otro código.",
    );
  }
  return { code, uploadToken };
}

/**
 * La clave de idempotencia la decide quien llama: un reintento del mismo
 * intento reutiliza la misma clave y el mismo archivo para reanudar la carga
 * en el servidor en vez de duplicarla.
 */
export async function uploadConsignmentPhoto(input: {
  code: string;
  uploadToken: string;
  idempotencyKey: string;
  captureType: string;
  file: File;
}): Promise<void> {
  const blob = await reencodePhoto(input.file);
  const response = await fetch(
    `/api/v1/consignments/${encodeURIComponent(input.code)}/photos`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.uploadToken}`,
        "Content-Type": blob.type || "image/jpeg",
        "X-Capture-Type": input.captureType,
        "Idempotency-Key": input.idempotencyKey,
      },
      body: blob,
    },
  );
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "No pudimos subir la foto."));
  }
}
