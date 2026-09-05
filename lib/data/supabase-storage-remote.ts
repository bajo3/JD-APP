/**
 * Adaptador de Supabase Storage (protocolo S3) para funciones Node (por
 * ejemplo, Vercel). Supabase Storage mantiene los bytes; la autorización y el
 * estado READY siguen siendo responsabilidad de los servicios que llaman a
 * ObjectStore.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStore } from "@/lib/data/storage";
import { MAX_MEDIA_IMAGE_BYTES } from "@/lib/media/policy.mjs";

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

type S3ClientLike = Pick<S3Client, "send">;

export type SupabaseStorageRemoteConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  client?: S3ClientLike;
}>;

export class RemoteSupabaseStorageError extends Error {
  readonly code: "SUPABASE_STORAGE_REMOTE_CONFIG_INVALID" | "SUPABASE_STORAGE_REMOTE_REQUEST_FAILED";

  constructor(code: RemoteSupabaseStorageError["code"]) {
    super(
      code === "SUPABASE_STORAGE_REMOTE_CONFIG_INVALID"
        ? "La configuración de Supabase Storage remoto no es válida."
        : "El almacenamiento remoto no respondió correctamente.",
    );
    this.name = "RemoteSupabaseStorageError";
    this.code = code;
  }
}

export class RemoteSupabaseStorageObjectStore implements ObjectStore {
  readonly #bucket: string;
  readonly #client: S3ClientLike;

  constructor(config: SupabaseStorageRemoteConfig) {
    const endpoint = normalizedEndpoint(config.endpoint);
    const region = config.region.trim();
    const bucket = config.bucket.trim();
    const accessKeyId = config.accessKeyId.trim();
    const secretAccessKey = config.secretAccessKey.trim();
    if (!endpoint || !region || !isBucketName(bucket) || !accessKeyId || !secretAccessKey) {
      throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_CONFIG_INVALID");
    }

    this.#bucket = bucket;
    this.#client = config.client ?? new S3Client({
      region,
      endpoint,
      // El endpoint S3 de Supabase Storage vive bajo /storage/v1/s3 y espera
      // el bucket como primer segmento de ruta, no como subdominio.
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async putStockImage(input: {
    vehicleId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
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
    await this.#put(key, input.body, input.contentType, {
      vehicleId: input.vehicleId,
      byteSize: String(input.byteSize),
      sha256: input.sha256,
      visibility: "public",
    });
    return key;
  }

  async putPrivateAppraisalImage(input: {
    appraisalId: string;
    mediaId: string;
    body: ReadableStream | ArrayBuffer | ArrayBufferView;
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
    await this.#put(key, input.body, input.contentType, {
      appraisalId: input.appraisalId,
      sha256: input.sha256,
      visibility: "private",
    });
    return key;
  }

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
    await this.#put(key, input.body, input.contentType, {
      consignmentId: input.consignmentId,
      sha256: input.sha256,
      visibility: "private",
    });
    return key;
  }

  getStockObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("public/stock/")) throw new Error("STOCK_OBJECT_KEY_REQUIRED");
    return this.#get(key);
  }

  getPrivateObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("private/")) throw new Error("PRIVATE_OBJECT_KEY_REQUIRED");
    return this.#get(key);
  }

  async deleteObject(key: string): Promise<void> {
    if (!key.trim()) throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_CONFIG_INVALID");
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch {
      throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_REQUEST_FAILED");
    }
  }

  async #put(
    key: string,
    body: ReadableStream | ArrayBuffer | ArrayBufferView,
    contentType: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    try {
      await this.#client.send(new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: toS3Payload(body),
        ContentType: contentType,
        Metadata: metadata,
      }));
    } catch {
      throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_REQUEST_FAILED");
    }
  }

  async #get(key: string): Promise<R2ObjectBody | null> {
    try {
      const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      const body = response.Body;
      if (!isS3Body(body)) throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_REQUEST_FAILED");
      return new RemoteSupabaseStorageObjectBody(body);
    } catch (error) {
      if (isMissingObject(error)) return null;
      if (error instanceof RemoteSupabaseStorageError) throw error;
      throw new RemoteSupabaseStorageError("SUPABASE_STORAGE_REMOTE_REQUEST_FAILED");
    }
  }
}

class RemoteSupabaseStorageObjectBody implements R2ObjectBody {
  #used = false;
  readonly #body: S3Body;

  constructor(body: S3Body) {
    this.#body = body;
  }

  get body(): ReadableStream {
    this.#used = true;
    return this.#body.transformToWebStream();
  }

  get bodyUsed(): boolean {
    return this.#used;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.#used = true;
    const bytes = await this.#body.transformToByteArray();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async text(): Promise<string> {
    this.#used = true;
    return this.#body.transformToString();
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.arrayBuffer()]);
  }
}

type S3Body = Readonly<{
  transformToByteArray(): Promise<Uint8Array>;
  transformToString(encoding?: string): Promise<string>;
  transformToWebStream(): ReadableStream;
}>;

function isS3Body(value: unknown): value is S3Body {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<S3Body>;
  return typeof body.transformToByteArray === "function"
    && typeof body.transformToString === "function"
    && typeof body.transformToWebStream === "function";
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NoSuchKey" || candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

// El endpoint S3 de Supabase Storage incluye una ruta fija (/storage/v1/s3),
// a diferencia de R2 que usa la raíz del host; se acepta cualquier ruta, sólo
// se exige HTTPS y ausencia de credenciales/consulta embebidas en la URL.
function normalizedEndpoint(value: string): string | null {
  try {
    const endpoint = new URL(value.trim());
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      return null;
    }
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isBucketName(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) && !value.includes("..");
}

function toS3Payload(body: ReadableStream | ArrayBuffer | ArrayBufferView): ReadableStream | Uint8Array {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return body;
}
