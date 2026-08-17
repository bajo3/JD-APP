import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("offer countdown hydrates from a stable placeholder", () => {
  const source = readFileSync("app/_components/OfferCountdown.tsx", "utf8");

  assert.match(source, /useState<number \| null>\(null\)/);
  assert.doesNotMatch(source, /useState\(\(\)\s*=>[\s\S]*Date\.now/);
  assert.match(source, /Calculando vigencia de la oferta/);
});
