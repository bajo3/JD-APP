// Generates the PWA PNG icons from the geometric favicon mark using a
// dependency-free PNG encoder (RGBA, filter 0, zlib deflate).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(projectRoot, "public");

const BACKGROUND = [24, 32, 31, 255]; // #18201f (theme color, solid for maskable)
const QUADS = [
  { x: 12, y: 12, size: 10, radius: 2.7273, color: [104, 196, 255, 255] }, // #68C4FF
  { x: 15, y: 2, size: 7, radius: 1, color: [12, 121, 216, 255] }, // #0C79D8
  { x: 2, y: 15, size: 7, radius: 1, color: [12, 121, 216, 255] },
  { x: 2, y: 2, size: 10, radius: 2.7273, color: [46, 158, 255, 255] }, // #2E9EFF
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedQuad(px, py, quad, scale, offset) {
  const left = offset + quad.x * scale;
  const top = offset + quad.y * scale;
  const right = left + quad.size * scale;
  const bottom = top + quad.size * scale;
  const radius = quad.radius * scale;
  if (px < left || px > right || py < top || py > bottom) return false;
  const cx = Math.min(Math.max(px, left + radius), right - radius);
  const cy = Math.min(Math.max(py, top + radius), bottom - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius + 0.75;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const markSpan = 20; // the mark spans units 2..22 in the 24-unit grid
  const scale = (size * 0.72) / markSpan;
  const offset = (size - markSpan * scale) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = BACKGROUND;
      for (const quad of QUADS) {
        if (insideRoundedQuad(x + 0.5, y + 0.5, quad, scale, offset)) {
          color = quad.color;
          break;
        }
      }
      const index = (y * size + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = color[3];
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "icon-192.png"), renderIcon(192));
writeFileSync(join(publicDir, "icon-512.png"), renderIcon(512));
writeFileSync(join(publicDir, "apple-touch-icon.png"), renderIcon(180));
console.log("PWA icons written to public/");
