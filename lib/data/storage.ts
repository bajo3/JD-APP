import { RemoteSupabaseStorageObjectStore } from "@/lib/data/supabase-storage-remote";
import { MAX_MEDIA_IMAGE_BYTES } from "@/lib/media/policy.mjs";

// Only formats whose metadata the server strips before persisting; HEIC/AVIF
// cannot be sanitized without server-side re-encoding and stay out.
const ALLOWED_APPRAISAL_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_STOCK_IMAGE_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ObjectStore {
  putStockImage(input: {
    vehicleId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string>;
  putPrivateAppraisalImage(input: {
    appraisalId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string>;
  putPrivateConsignmentImage(input: {
    consignmentId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string>;
  getStockObject(key: string): Promise<R2ObjectBody | null>;
  getPrivateObject(key: string): Promise<R2ObjectBody | null>;
  deleteObject(key: string): Promise<void>;
}

export class SupabaseObjectStore implements ObjectStore {
  async putStockImage(input: {
    vehicleId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string> {
    if (!ALLOWED_STOCK_IMAGE_TYPES.has(input.contentType)) {
      throw new Error("UNSUPPORTED_STOCK_IMAGE_TYPE");
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_MEDIA_IMAGE_BYTES) {
      throw new Error("STOCK_IMAGE_SIZE_OUT_OF_RANGE");
    }
    const key = `public/stock/${input.vehicleId}/${input.mediaId}`;
    await remoteStore().putStockImage({
      vehicleId: input.vehicleId,
      mediaId: input.mediaId,
      body: input.body,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
    });
    return key;
  }

  async putPrivateAppraisalImage(input: {
    appraisalId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string> {
    if (!ALLOWED_APPRAISAL_IMAGE_TYPES.has(input.contentType)) {
      throw new Error("UNSUPPORTED_APPRAISAL_IMAGE_TYPE");
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_MEDIA_IMAGE_BYTES) {
      throw new Error("APPRAISAL_IMAGE_SIZE_OUT_OF_RANGE");
    }

    const key = `private/appraisals/${input.appraisalId}/${input.mediaId}`;
    await remoteStore().putPrivateAppraisalImage({
      appraisalId: input.appraisalId,
      mediaId: input.mediaId,
      body: input.body,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
    });
    return key;
  }

  // Consignment photos share the appraisal image policy: only formats whose
  // metadata the server strips, capped at the same size.
  async putPrivateConsignmentImage(input: {
    consignmentId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<string> {
    if (!ALLOWED_APPRAISAL_IMAGE_TYPES.has(input.contentType)) {
      throw new Error("UNSUPPORTED_CONSIGNMENT_IMAGE_TYPE");
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_MEDIA_IMAGE_BYTES) {
      throw new Error("CONSIGNMENT_IMAGE_SIZE_OUT_OF_RANGE");
    }
    const key = `private/consignments/${input.consignmentId}/${input.mediaId}`;
    await remoteStore().putPrivateConsignmentImage({
      consignmentId: input.consignmentId,
      mediaId: input.mediaId,
      body: input.body,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
    });
    return key;
  }

  getStockObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("public/stock/")) {
      throw new Error("STOCK_OBJECT_KEY_REQUIRED");
    }
    return remoteStore().getStockObject(key);
  }

  getPrivateObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("private/")) {
      throw new Error("PRIVATE_OBJECT_KEY_REQUIRED");
    }
    return remoteStore().getPrivateObject(key);
  }

  async deleteObject(key: string): Promise<void> {
    await remoteStore().deleteObject(key);
  }
}

// The app owns authorization and signed-delivery policy. This adapter only
// persists private bytes; it never constructs a public URL for appraisal media.
export const objectStore: ObjectStore = new SupabaseObjectStore();

let remote: RemoteSupabaseStorageObjectStore | undefined;

function remoteStore(): RemoteSupabaseStorageObjectStore {
  remote ??= new RemoteSupabaseStorageObjectStore({
    endpoint: requiredEnvironment("SUPABASE_STORAGE_ENDPOINT"),
    region: requiredEnvironment("SUPABASE_STORAGE_REGION"),
    bucket: requiredEnvironment("SUPABASE_STORAGE_BUCKET"),
    accessKeyId: requiredEnvironment("SUPABASE_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("SUPABASE_STORAGE_SECRET_ACCESS_KEY"),
  });
  return remote;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`La configuración requerida ${name} no está disponible.`);
  return value;
}
