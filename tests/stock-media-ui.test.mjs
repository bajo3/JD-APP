import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("stock media manager uses the protected binary and version contracts", async () => {
  const source = await readFile(
    new URL("app/panel/_components/VehicleMediaManager.tsx", root),
    "utf8",
  );
  assert.match(source, /"Content-Type": file\.type/);
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
  assert.match(source, /"X-Vehicle-Version": String\(vehicleVersion\)/);
  assert.match(source, /"X-Alt-Text": altText\.trim\(\)/);
  assert.match(source, /body:\s*file/);
  assert.match(source, /action: "set_primary"/);
  assert.match(source, /action: "reorder"/);
  assert.match(source, /action: "archive"/);
  assert.doesNotMatch(source, /window\.prompt/);
});

test("public vehicle surfaces preserve their image fallback", async () => {
  const [home, card, detail, offer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/_components/VehicleCard.tsx", root), "utf8"),
    readFile(new URL("app/autos/[slug]/page.tsx", root), "utf8"),
    readFile(new URL("app/oferta-del-dia/page.tsx", root), "utf8"),
  ]);
  assert.match(home, /offer\.vehicle\.image/);
  assert.match(card, /vehicle\.image/);
  assert.match(card, /small-car/);
  assert.match(detail, /detail-real-image/);
  assert.match(detail, /detail-car/);
  assert.match(offer, /offer-real-image/);
  assert.match(offer, /offer-car/);
});
