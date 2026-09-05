// Vercel Functions cap request/response payloads at 4.5 MB. Keep every image
// below that platform limit with one application-wide 4 MiB boundary.
export const MAX_MEDIA_IMAGE_BYTES = 4 * 1024 * 1024;

// Compatibility aliases for callers that still use the media-specific names.
// All image policies intentionally resolve to the same byte boundary.
export const MAX_STOCK_IMAGE_BYTES = MAX_MEDIA_IMAGE_BYTES;

export const STOCK_IMAGE_CONTENT_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

// Appraisal photos accept only formats whose metadata this code base can strip
// deterministically before persisting; HEIC/AVIF stay out until re-encoding
// exists server-side.
export const MAX_APPRAISAL_IMAGE_BYTES = MAX_MEDIA_IMAGE_BYTES;

export const APPRAISAL_IMAGE_CONTENT_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MEDIA_POLICY_ERROR_CODES = Object.freeze({
  INVALID_BYTES: "STOCK_IMAGE_INVALID_BYTES",
  EMPTY: "STOCK_IMAGE_EMPTY",
  TOO_LARGE: "STOCK_IMAGE_TOO_LARGE",
  UNSUPPORTED_CONTENT_TYPE: "STOCK_IMAGE_UNSUPPORTED_CONTENT_TYPE",
  CONTENT_TYPE_MISMATCH: "STOCK_IMAGE_CONTENT_TYPE_MISMATCH",
  INVALID_SIGNATURE: "STOCK_IMAGE_INVALID_SIGNATURE",
  TRUNCATED: "STOCK_IMAGE_TRUNCATED",
  MALFORMED: "STOCK_IMAGE_MALFORMED",
  HASH_UNAVAILABLE: "STOCK_IMAGE_HASH_UNAVAILABLE",
});

const ERROR_MESSAGES = Object.freeze({
  [MEDIA_POLICY_ERROR_CODES.INVALID_BYTES]: "La imagen no contiene bytes válidos.",
  [MEDIA_POLICY_ERROR_CODES.EMPTY]: "La imagen está vacía.",
  [MEDIA_POLICY_ERROR_CODES.TOO_LARGE]: "La imagen supera el máximo de 4 MiB.",
  [MEDIA_POLICY_ERROR_CODES.UNSUPPORTED_CONTENT_TYPE]: "El tipo de imagen no está permitido.",
  [MEDIA_POLICY_ERROR_CODES.CONTENT_TYPE_MISMATCH]: "El contenido de la imagen no coincide con el tipo declarado.",
  [MEDIA_POLICY_ERROR_CODES.INVALID_SIGNATURE]: "La firma binaria de la imagen no es válida.",
  [MEDIA_POLICY_ERROR_CODES.TRUNCATED]: "La imagen está truncada.",
  [MEDIA_POLICY_ERROR_CODES.MALFORMED]: "La estructura binaria de la imagen no es válida.",
  [MEDIA_POLICY_ERROR_CODES.HASH_UNAVAILABLE]: "No se pudo calcular la huella de la imagen.",
});

export class MediaPolicyError extends Error {
  constructor(code, details = null) {
    super(ERROR_MESSAGES[code] ?? "La imagen no cumple la política de archivos.");
    this.name = "MediaPolicyError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.details ? { details: Object.freeze({ ...this.details }) } : {}),
    });
  }
}

/**
 * Validates stock image bytes and returns immutable metadata. It performs no
 * filesystem or Node-specific operation and is safe to call from a Worker.
 */
export async function inspectStockImage({ bytes, declaredContentType } = {}) {
  return inspectImage({ bytes, declaredContentType, allowedContentTypes: STOCK_IMAGE_CONTENT_TYPES });
}

/**
 * Same binary guarantees as stock images, with appraisal-specific limits.
 * @returns {Promise<{contentType: string, byteSize: number, sha256: string}>}
 */
export async function inspectAppraisalImage({ bytes, declaredContentType } = {}) {
  return inspectImage({
    bytes,
    declaredContentType,
    allowedContentTypes: APPRAISAL_IMAGE_CONTENT_TYPES,
    maxBytes: MAX_APPRAISAL_IMAGE_BYTES,
  });
}

async function inspectImage({
  bytes,
  declaredContentType,
  allowedContentTypes = STOCK_IMAGE_CONTENT_TYPES,
  maxBytes = MAX_STOCK_IMAGE_BYTES,
} = {}) {
  const input = asUint8Array(bytes);
  if (input.byteLength === 0) fail(MEDIA_POLICY_ERROR_CODES.EMPTY);
  if (input.byteLength > maxBytes) {
    fail(MEDIA_POLICY_ERROR_CODES.TOO_LARGE, {
      byteSize: input.byteLength,
      maximumByteSize: maxBytes,
    });
  }

  const contentType = normalizeContentType(declaredContentType, allowedContentTypes);
  const detected = detectContentType(input);
  if (detected && detected !== contentType) {
    fail(MEDIA_POLICY_ERROR_CODES.CONTENT_TYPE_MISMATCH, {
      declaredContentType: contentType,
      detectedContentType: detected,
    });
  }

  if (contentType === "image/jpeg") validateJpeg(input);
  else if (contentType === "image/png") validatePng(input);
  else if (contentType === "image/webp") validateWebp(input);
  else validateAvif(input);

  const sha256 = await digestSha256(input);
  return Object.freeze({ contentType, byteSize: input.byteLength, sha256 });
}

/**
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} bytes
 * @returns {Promise<string>}
 */
export async function digestImageSha256(bytes) {
  return digestSha256(asUint8Array(bytes));
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  fail(MEDIA_POLICY_ERROR_CODES.INVALID_BYTES);
}

function normalizeContentType(value, allowedContentTypes = STOCK_IMAGE_CONTENT_TYPES) {
  if (typeof value !== "string") {
    fail(MEDIA_POLICY_ERROR_CODES.UNSUPPORTED_CONTENT_TYPE);
  }
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (!allowedContentTypes.includes(normalized)) {
    fail(MEDIA_POLICY_ERROR_CODES.UNSUPPORTED_CONTENT_TYPE, {
      declaredContentType: normalized || null,
    });
  }
  return normalized;
}

function detectContentType(bytes) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.byteLength >= 16 && ascii(bytes, 4, 4) === "ftyp" && avifBrands(bytes).some(isAvifBrand)) {
    return "image/avif";
  }
  return null;
}

function validateJpeg(bytes) {
  if (bytes.byteLength < 4) truncated();
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) invalidSignature();
  let offset = 2;
  let inScan = false;
  let sawFrame = false;
  let sawScan = false;

  while (offset < bytes.byteLength) {
    if (inScan && bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    if (bytes[offset] !== 0xff) malformed();
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) truncated();
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00) {
      if (!inScan) malformed();
      continue;
    }
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan || offset !== bytes.byteLength) malformed();
      return;
    }
    if (marker === 0xd8) malformed();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!inScan && marker !== 0x01) malformed();
      continue;
    }

    if (offset + 2 > bytes.byteLength) truncated();
    const segmentLength = readU16Be(bytes, offset);
    if (segmentLength < 2) malformed();
    if (offset + segmentLength > bytes.byteLength) truncated();
    if (isStartOfFrame(marker)) {
      if (segmentLength < 11) malformed();
      sawFrame = true;
    }
    if (marker === 0xda) {
      if (!sawFrame || segmentLength < 8) malformed();
      sawScan = true;
      inScan = true;
    } else {
      inScan = false;
    }
    offset += segmentLength;
  }
  truncated();
}

function validatePng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < signature.length) truncated();
  if (!startsWith(bytes, signature)) invalidSignature();
  let offset = signature.length;
  let chunkIndex = 0;
  let sawData = false;

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) truncated();
    const length = readU32Be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) truncated();
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) malformed();
    if (type === "IHDR") {
      if (chunkIndex !== 0 || readU32Be(bytes, offset + 8) === 0 || readU32Be(bytes, offset + 12) === 0) {
        malformed();
      }
    }
    if (type === "IDAT") sawData = true;
    if (type === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.byteLength) malformed();
      return;
    }
    offset = end;
    chunkIndex += 1;
  }
  truncated();
}

function validateWebp(bytes) {
  if (bytes.byteLength < 12) truncated();
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    invalidSignature();
  }
  const declaredSize = readU32Le(bytes, 4) + 8;
  if (declaredSize > bytes.byteLength) truncated();
  if (declaredSize !== bytes.byteLength) malformed();
  let offset = 12;
  let sawImageData = false;

  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) truncated();
    const type = ascii(bytes, offset, 4);
    const length = readU32Le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.byteLength) truncated();
    if (type === "VP8 ") {
      if (length < 10 || !startsWithAt(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) malformed();
      sawImageData = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) malformed();
      sawImageData = true;
    } else if (type === "VP8X" && length !== 10) {
      malformed();
    }
    offset = dataEnd + (length % 2);
    if (offset > bytes.byteLength) truncated();
  }
  if (offset !== bytes.byteLength) truncated();
  if (!sawImageData) malformed();
}

function validateAvif(bytes) {
  if (bytes.byteLength < 16) truncated();
  if (ascii(bytes, 4, 4) !== "ftyp") invalidSignature();
  const brands = avifBrands(bytes);
  if (!brands.some(isAvifBrand)) invalidSignature();
  let offset = 0;
  let boxIndex = 0;
  let sawMeta = false;

  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) truncated();
    const box = readIsoBox(bytes, offset);
    if (boxIndex === 0 && box.type !== "ftyp") malformed();
    if (box.type === "ftyp" && box.size < 16) malformed();
    if (box.type === "meta") {
      if (box.size < box.headerSize + 4) malformed();
      sawMeta = true;
    }
    offset = box.end;
    boxIndex += 1;
    if (box.extendsToEnd) break;
  }
  if (offset !== bytes.byteLength) truncated();
  if (!sawMeta) malformed();
}

function readIsoBox(bytes, offset) {
  const size32 = readU32Be(bytes, offset);
  const type = ascii(bytes, offset + 4, 4);
  let headerSize = 8;
  let size = size32;
  let extendsToEnd = false;
  if (size32 === 1) {
    if (offset + 16 > bytes.byteLength) truncated();
    const high = readU32Be(bytes, offset + 8);
    const low = readU32Be(bytes, offset + 12);
    size = high * 2 ** 32 + low;
    headerSize = 16;
    if (!Number.isSafeInteger(size)) malformed();
  } else if (size32 === 0) {
    size = bytes.byteLength - offset;
    extendsToEnd = true;
  }
  if (size < headerSize) malformed();
  const end = offset + size;
  if (!Number.isSafeInteger(end)) malformed();
  if (end > bytes.byteLength) truncated();
  return { type, size, headerSize, end, extendsToEnd };
}

function avifBrands(bytes) {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== "ftyp") return [];
  const firstBoxSize = readU32Be(bytes, 0);
  if (firstBoxSize < 16 || firstBoxSize > bytes.byteLength) return [];
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= firstBoxSize; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  return brands;
}

function isAvifBrand(value) {
  return value === "avif" || value === "avis";
}

async function digestSha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail(MEDIA_POLICY_ERROR_CODES.HASH_UNAVAILABLE);
  try {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    fail(MEDIA_POLICY_ERROR_CODES.HASH_UNAVAILABLE);
  }
}

function isStartOfFrame(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function startsWith(bytes, expected) {
  return startsWithAt(bytes, 0, expected);
}

function startsWithAt(bytes, offset, expected) {
  if (offset + expected.length > bytes.byteLength) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) return "";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index]);
  }
  return result;
}

function readU16Be(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function readU32Be(bytes, offset) {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function readU32Le(bytes, offset) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 2 ** 8 +
    bytes[offset + 2] * 2 ** 16 +
    bytes[offset + 3] * 2 ** 24
  );
}

function invalidSignature() {
  fail(MEDIA_POLICY_ERROR_CODES.INVALID_SIGNATURE);
}

function truncated() {
  fail(MEDIA_POLICY_ERROR_CODES.TRUNCATED);
}

function malformed() {
  fail(MEDIA_POLICY_ERROR_CODES.MALFORMED);
}

function fail(code, details = null) {
  throw new MediaPolicyError(code, details);
}
