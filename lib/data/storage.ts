import { getUploadsBucket } from "@/db";

const MAX_APPRAISAL_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_APPRAISAL_IMAGE_TYPES = new Set([
  "image/avif",
  "image/heic",
  "image/heif",
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
  getStockObject(key: string): Promise<R2ObjectBody | null>;
  getPrivateObject(key: string): Promise<R2ObjectBody | null>;
  deleteObject(key: string): Promise<void>;
}

export class R2ObjectStore implements ObjectStore {
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
    const key = `public/stock/${input.vehicleId}/${input.mediaId}`;
    await getUploadsBucket().put(key, input.body, {
      httpMetadata: { contentType: input.contentType },
      customMetadata: {
        vehicleId: input.vehicleId,
        byteSize: String(input.byteSize),
        sha256: input.sha256,
        visibility: "public",
      },
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
    if (input.byteSize <= 0 || input.byteSize > MAX_APPRAISAL_IMAGE_BYTES) {
      throw new Error("APPRAISAL_IMAGE_SIZE_OUT_OF_RANGE");
    }

    const key = `private/appraisals/${input.appraisalId}/${input.mediaId}`;
    await getUploadsBucket().put(key, input.body, {
      httpMetadata: { contentType: input.contentType },
      customMetadata: {
        appraisalId: input.appraisalId,
        sha256: input.sha256,
        visibility: "private",
      },
    });
    return key;
  }

  getStockObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("public/stock/")) {
      throw new Error("STOCK_OBJECT_KEY_REQUIRED");
    }
    return getUploadsBucket().get(key);
  }

  getPrivateObject(key: string): Promise<R2ObjectBody | null> {
    if (!key.startsWith("private/")) {
      throw new Error("PRIVATE_OBJECT_KEY_REQUIRED");
    }
    return getUploadsBucket().get(key);
  }

  async deleteObject(key: string): Promise<void> {
    await getUploadsBucket().delete(key);
  }
}

// The app owns authorization and signed-delivery policy. This adapter only
// persists private bytes; it never constructs a public URL for appraisal media.
export const objectStore: ObjectStore = new R2ObjectStore();
