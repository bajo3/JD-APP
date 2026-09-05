"use client";

import { MAX_MEDIA_IMAGE_BYTES } from "@/lib/media/policy.mjs";

const MAX_PHOTO_EDGE = 2048;
const SANITIZABLE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
    if (typeof createImageBitmap !== "function") throw new Error("bitmap_unavailable");
    const bitmap = await createImageBitmap(file);
    try {
      if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) {
        throw new Error("invalid_bitmap_dimensions");
      }
      // Lower quality first, then dimensions, until the result is guaranteed
      // to fit the same limit enforced by every upload endpoint.
      for (const maxEdge of [MAX_PHOTO_EDGE, 1600, 1280, 1024, 768, 640]) {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas_context_unavailable");
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.85, 0.7, 0.55, 0.4]) {
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/jpeg", quality);
          });
          if (blob?.type === "image/jpeg" && blob.size > 0 && blob.size <= MAX_MEDIA_IMAGE_BYTES) {
            return blob;
          }
        }
      }
      throw new Error("reencode_too_large");
    } finally {
      bitmap.close();
    }
  } catch {
    const contentType = file.type.trim().toLowerCase();
    if (SANITIZABLE_CONTENT_TYPES.has(contentType) && file.size > 0 && file.size <= MAX_MEDIA_IMAGE_BYTES) {
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
