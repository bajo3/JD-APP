import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = [
  "app/page.tsx",
  "app/stock/page.tsx",
  "app/autos/[slug]/page.tsx",
  "app/oferta-del-dia/page.tsx",
];

test("public read pages use server data helpers without internal HTTP", async () => {
  for (const path of pages) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.match(source, /getPublic(?:Home|Stock|Vehicle|Offer)/, path);
    assert.match(source, /force-dynamic/, path);
    assert.doesNotMatch(source, /fetch\s*\(\s*["']\/api\//, path);
    assert.doesNotMatch(source, /mockVehicles/, path);
  }
});

test("vehicle detail awaits params and publishes data-specific metadata", async () => {
  const source = await readFile(new URL("app/autos/[slug]/page.tsx", root), "utf8");
  assert.match(source, /params:\s*Promise<\{ slug: string \}>/);
  assert.match(source, /const \{ slug \} = await params/);
  assert.match(source, /export async function generateMetadata/);
  assert.match(source, /vehicle\.name/);
});

test("fixture access remains behind getDataAccess", async () => {
  const source = await readFile(new URL("lib/server/public-data.ts", root), "utf8");
  assert.match(source, /getDataAccess\(\)/);
  assert.doesNotMatch(source, /lib\/data\/fixtures|mock-data/);
});

test("home and offer use the real promotion deadline without hardcoded inventory", async () => {
  for (const path of ["app/page.tsx", "app/oferta-del-dia/page.tsx"]) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.match(source, /<OfferCountdown endsAt=\{offer\.endsAt\}/, path);
    assert.doesNotMatch(source, /2026-|Toyota Corolla|\$25\.500\.000|const cars/, path);
  }
  const home = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.doesNotMatch(home, /DESDE 1998/);
  assert.match(home, /TANDIL · COMPRA INTELIGENTE/);
});
