/**
 * Server-side metadata stripping for user-uploaded appraisal photos.
 * JPEG: drops APPn segments except JFIF APP0, and comment segments.
 * PNG: drops textual/EXIF/timestamp ancillary chunks.
 * WebP: drops EXIF and XMP chunks and clears the VP8X feature flags.
 * The operations are pure byte manipulations and never re-encode pixels.
 */

const JPEG_KEEP_APP0 = 0xe0;
const JPEG_COM = 0xfe;

const PNG_DROP_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

const WEBP_DROP_CHUNKS = new Set(["EXIF", "XMP "]);
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

export function stripImageMetadata(bytes, contentType) {
  const input = asUint8Array(bytes);
  if (input.byteLength === 0) return { bytes: input, changed: false };
  if (contentType === "image/jpeg") return stripJpeg(input);
  if (contentType === "image/png") return stripPng(input);
  if (contentType === "image/webp") return stripWebp(input);
  return { bytes: input, changed: false };
}

function stripJpeg(input) {
  const kept = [];
  let offset = 2;
  let inScan = false;
  let scanStart = -1;
  let changed = false;

  while (offset < input.byteLength) {
    if (inScan && input[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    if (input[offset] !== 0xff) break;
    const ffPos = offset;
    while (offset < input.byteLength && input[offset] === 0xff) offset += 1;
    if (offset >= input.byteLength) break;
    const marker = input[offset];
    const markerEnd = offset + 1;
    offset = markerEnd;

    if (inScan && scanStart >= 0 && scanStart < ffPos) {
      kept.push(input.subarray(scanStart, ffPos));
      scanStart = -1;
    }

    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(input.subarray(ffPos, markerEnd));
      continue;
    }
    if (marker === 0xd9) {
      kept.push(input.subarray(ffPos, markerEnd));
      if (!changed) return { bytes: input, changed: false };
      return { bytes: concat([input.subarray(0, 2), ...kept]), changed: true };
    }
    if (marker === 0xd8) break;
    if (markerEnd + 2 > input.byteLength) break;
    const segmentLength = (input[markerEnd] << 8) | input[markerEnd + 1];
    if (segmentLength < 2) break;
    const segmentEnd = markerEnd + segmentLength;
    if (segmentEnd > input.byteLength) break;

    const isAppMarker = (marker & 0xf0) === 0xe0;
    const drop =
      marker === JPEG_COM ||
      (isAppMarker && !(marker === JPEG_KEEP_APP0 && isJfifApp0(input, markerEnd, segmentLength)));
    if (drop) changed = true;
    else kept.push(input.subarray(ffPos, segmentEnd));

    if (marker === 0xda) {
      inScan = true;
      scanStart = segmentEnd;
    } else {
      inScan = false;
    }
    offset = segmentEnd;
  }
  return { bytes: input, changed: false };
}

function isJfifApp0(bytes, dataOffset, segmentLength) {
  if (segmentLength < 7) return false;
  return (
    bytes[dataOffset + 2] === 0x4a &&
    bytes[dataOffset + 3] === 0x46 &&
    bytes[dataOffset + 4] === 0x49 &&
    bytes[dataOffset + 5] === 0x46 &&
    bytes[dataOffset + 6] === 0x00
  );
}

function stripPng(input) {
  const signatureLength = 8;
  const kept = [input.subarray(0, signatureLength)];
  let offset = signatureLength;
  let changed = false;

  while (offset + 12 <= input.byteLength) {
    const length = readU32Be(input, offset);
    const type = ascii(input, offset + 4, 4);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > input.byteLength) break;
    if (PNG_DROP_CHUNKS.has(type)) changed = true;
    else kept.push(input.subarray(offset, end));
    if (type === "IEND") {
      if (!changed) return { bytes: input, changed: false };
      return { bytes: concat(kept), changed };
    }
    offset = end;
  }
  return { bytes: input, changed: false };
}

function stripWebp(input) {
  if (input.byteLength < 12) return { bytes: input, changed: false };
  const chunks = [];
  let offset = 12;
  let changed = false;
  let sawIend = false;

  while (offset + 8 <= input.byteLength) {
    const type = ascii(input, offset, 4);
    const length = readU32Le(input, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > input.byteLength) break;
    const paddedEnd = dataEnd + (length % 2);
    if (paddedEnd > input.byteLength) break;

    if (WEBP_DROP_CHUNKS.has(type)) {
      changed = true;
    } else if (type === "VP8X" && length >= 1) {
      const flags = input[dataOffset];
      const cleared = flags & ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
      if (cleared !== flags) {
        changed = true;
        const replacement = new Uint8Array(input.subarray(offset, paddedEnd));
        replacement[8] = cleared;
        chunks.push(replacement);
      } else {
        chunks.push(input.subarray(offset, paddedEnd));
      }
    } else {
      chunks.push(input.subarray(offset, paddedEnd));
    }
    offset = paddedEnd;
    sawIend = true;
  }
  if (!changed || !sawIend) return { bytes: input, changed: false };

  let payloadSize = 0;
  for (const chunk of chunks) payloadSize += chunk.byteLength;
  const output = new Uint8Array(12 + payloadSize);
  output.set(input.subarray(0, 4), 0);
  new DataView(output.buffer).setUint32(4, 4 + payloadSize, true);
  output.set(input.subarray(8, 12), 8);
  let cursor = 12;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return { bytes: output, changed: true };
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(0);
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) return "";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index]);
  }
  return result;
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
