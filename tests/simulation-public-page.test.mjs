import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the public simulation snapshot page exists and reads the frozen snapshot server-side", async () => {
  const source = await readFile(new URL("app/simulaciones/[codigo]/page.tsx", root), "utf8");
  assert.match(source, /findByPublicCode/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /force-dynamic/);
  assert.match(source, /robots:\s*{\s*index:\s*false/);
  assert.match(source, /listAvailable/);
  assert.match(source, /ya no está publicada/);
  assert.match(source, /publicSimulationView/);
  // The page must never read lead identity or events.
  assert.doesNotMatch(source, /leads\.|lead\.findById|lead_events/);

  // The customer view maps the persisted snapshot and nothing else.
  const view = await readFile(new URL("lib/server/public-simulation.ts", root), "utf8");
  const code = view.replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /disclaimerSnapshot/);
  assert.doesNotMatch(code, /leadId|idempotency|inputSnapshot|resultSnapshot/i);
});

test("the snapshot page renders the frozen disclaimer and expiry state", async () => {
  const source = await readFile(new URL("app/simulaciones/[codigo]/page.tsx", root), "utf8");
  assert.match(source, /Operación vencida/);
  assert.match(source, /expiresAt/);
  assert.match(source, /Vigente/);
  assert.doesNotMatch(source, /fetch\(|\/api\/v1/);
});

test("the route joins the six public V1 surfaces", async () => {
  await assert.doesNotReject(access(new URL("app/simulaciones/[codigo]/page.tsx", root)));
  const structure = await readFile(new URL("tests/site-structure.test.mjs", root), "utf8");
  assert.match(structure, /app\/simulaciones\/\[codigo\]\/page\.tsx/);
});
