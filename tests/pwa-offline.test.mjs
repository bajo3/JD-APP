import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);

test("the service worker never caches API responses and falls back offline", async () => {
  const source = await readFile(new URL("public/sw.js", root), "utf8");
  assert.match(source, /\/offline/);
  assert.match(source, /method !== "GET"\) return/);
  assert.match(source, /startsWith\("\/api\/"\)\) return/);
  assert.match(source, /cache\.match\(request\)/);
  assert.doesNotMatch(source, /cache\.put\([^)]*api/i);
});

test("the offline screen is static and promises nothing about stock or prices", async () => {
  const source = await readFile(new URL("app/offline/page.tsx", root), "utf8");
  assert.match(source, /Sin conexión/);
  assert.doesNotMatch(source, /getDataAccess|findBySlug|listAvailable|fetch\(/);
});

test("the layout registers the service worker and renders the offline banner runtime", async () => {
  const layout = await readFile(new URL("app/layout.tsx", root), "utf8");
  const runtime = await readFile(new URL("app/_components/PwaRuntime.tsx", root), "utf8");
  assert.match(layout, /PwaRuntime/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(runtime, /serviceWorker/);
  assert.match(runtime, /addEventListener\("offline"/);
  assert.match(runtime, /aria-live="polite"/);
});

test("the manifest ships PNG icons for any and maskable purposes", async () => {
  const manifest = await readFile(new URL("app/manifest.ts", root), "utf8");
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(manifest, /purpose:"maskable"/);
  for (const icon of ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
    await assert.doesNotReject(access(new URL(`public/${icon}`, root)));
  }
});

test("generated icons are valid RGBA PNGs at the advertised sizes", async () => {
  const { readFile: read } = await import("node:fs/promises");
  for (const [file, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ]) {
    const bytes = await read(new URL(`public/${file}`, root));
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(bytes[24], 8);
    assert.equal(bytes[25], 6);
    // IHDR CRC present and an inflating IDAT closes the structural check.
    const idatStart = bytes.indexOf(Buffer.from("IDAT", "latin1"));
    assert.ok(idatStart > 0);
    const length = bytes.readUInt32BE(idatStart - 4);
    const raw = inflateSync(bytes.subarray(idatStart + 4, idatStart + 4 + length));
    assert.equal(raw.length, (size * 4 + 1) * size);
  }
});
