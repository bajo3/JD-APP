export declare const MAX_MEDIA_IMAGE_BYTES: number;
export declare const MAX_STOCK_IMAGE_BYTES: number;
export declare const MAX_APPRAISAL_IMAGE_BYTES: number;
export declare const STOCK_IMAGE_CONTENT_TYPES: readonly string[];
export declare const APPRAISAL_IMAGE_CONTENT_TYPES: readonly string[];
export declare const MEDIA_POLICY_ERROR_CODES: Readonly<Record<string, string>>;

export declare class MediaPolicyError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | null;
  constructor(code: string, details?: Record<string, unknown> | null);
  toJSON(): Readonly<Record<string, unknown>>;
}

export declare function inspectStockImage(input?: {
  bytes?: Uint8Array | ArrayBuffer | ArrayBufferView;
  declaredContentType?: string;
}): Promise<{
  contentType: string;
  byteSize: number;
  sha256: string;
}>;

export declare function inspectAppraisalImage(input?: {
  bytes?: Uint8Array | ArrayBuffer | ArrayBufferView;
  declaredContentType?: string;
}): Promise<{
  contentType: string;
  byteSize: number;
  sha256: string;
}>;

export declare function digestImageSha256(
  bytes: Uint8Array | ArrayBuffer | ArrayBufferView,
): Promise<string>;
