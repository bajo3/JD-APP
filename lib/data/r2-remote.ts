/**
 * Adaptador R2 para funciones Node (por ejemplo, Vercel). R2 mantiene los
 * bytes; la autorización y el estado READY siguen siendo responsabilidad de
 * los servicios que llaman a ObjectStore.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStore } from "@/lib/data/storage";

const MAX_APPRAISAL_IMAGE_BYTES = 10 * 1024 * 1024;
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

export type R2RemoteConfig = Readonly<{
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  client?: S3ClientLike;
}>;

export class RemoteR2Error extends Error {
  readonly code: "R2_REMOTE_CONFIG_INVALID" | "R2_REMOTE_REQUEST_FAILED";

  constructor(code: RemoteR2Error["code"]) {
    super(
      code === "R2_REMOTE_CONFIG_INVALID"
        ? "La configuración de R2 remoto no es válida."
        : "El almacenamiento remoto no respondió correctamente.",
    );
    this.name = "RemoteR2Error";
    this.code = code;
  }
}

export class RemoteR2ObjectStore implements ObjectStore {
  readonly #bucket: string;
  readonly #client: S3ClientLike;

  constructor(config: R2RemoteConfig) {
    const endpoint = normalizedEndpoint(config.endpoint);
    const bucket = config.bucket.trim();
    const accessKeyId = config.accessKeyId.trim();
    const secretAccessKey = config.secretAccessKey.trim();
    if (!endpoint || !isBucketName(bucket) || !accessKeyId || !secretAccessKey) {
      throw new RemoteR2Error("R2_REMOTE_CONFIG_INVALID");
    }

    this.#bucket = bucket;
    this.#client = config.client ?? new S3Client({
      region: "auto",
      endpoint,
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
    if (input.byteSize <= 0 || input.byteSize > MAX_APPRAISAL_IMAGE_BYTES) {
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
    if (input.byteSize <= 0 || input.byteSize > MAX_APPRAISAL_IMAGE_BYTES) {
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
    if (!key.trim()) throw new RemoteR2Error("R2_REMOTE_CONFIG_INVALID");
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch {
      throw new RemoteR2Error("R2_REMOTE_REQUEST_FAILED");
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
      throw new RemoteR2Error("R2_REMOTE_REQUEST_FAILED");
    }
  }

  async #get(key: string): Promise<R2ObjectBody | null> {
    try {
      const response = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
      const body = response.Body;
      if (!isS3Body(body)) throw new RemoteR2Error("R2_REMOTE_REQUEST_FAILED");
      return new RemoteR2ObjectBody(body);
    } catch (error) {
      if (isMissingObject(error)) return null;
      if (error instanceof RemoteR2Error) throw error;
      throw new RemoteR2Error("R2_REMOTE_REQUEST_FAILED");
    }
  }
}

class RemoteR2ObjectBody implements R2ObjectBody {
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

function normalizedEndpoint(value: string): string | null {
  try {
    const endpoint = new URL(value.trim());
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
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
