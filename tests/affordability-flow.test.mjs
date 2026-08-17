import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("dedicated affordability flow follows the conversion contract in order", async () => {
  const source = await readFile(
    new URL("app/_components/AffordabilityFlow.tsx", root),
    "utf8",
  );
  const affordability = source.indexOf('"/api/v1/affordability/search"');
  const simulation = source.indexOf('"/api/v1/simulations"');
  const lead = source.indexOf('"/api/v1/leads"');
  const handoff = source.indexOf('"/api/v1/whatsapp/handoffs"');
  assert.ok(affordability >= 0 && affordability < simulation);
  assert.ok(simulation < lead && lead < handoff);
  assert.match(source, /vehicleId: result\.vehicle\.id/);
  assert.match(source, /affordabilitySnapshot/);
  assert.match(source, /simulationCode: simulation\.code/);
  assert.match(source, /leadId: currentLead\.id/);
});

test("each retryable action has a stable scoped idempotency key", async () => {
  const source = await readFile(
    new URL("app/_components/AffordabilityFlow.tsx", root),
    "utf8",
  );
  assert.match(source, /keyFor\(actionKeys\.current, "search"\)/);
  assert.match(source, /keyFor\(actionKeys\.current, `simulation:\$\{result\.vehicle\.id\}`\)/);
  assert.match(source, /keyFor\(actionKeys\.current, "lead"\)/);
  assert.match(source, /keyFor\(actionKeys\.current, "handoff"\)/);
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
});

test("WhatsApp fallback preserves the operation code and contact phone", async () => {
  const source = await readFile(
    new URL("app/_components/AffordabilityFlow.tsx", root),
    "utf8",
  );
  assert.match(source, /WHATSAPP_NOT_CONFIGURED/);
  assert.match(source, /Código: <strong>\{simulation\.code\}/);
  assert.match(source, /Llamanos al \{contactPhone\}/);
  assert.match(source, /preliminar/gi);
});

test("finder page uses only the dedicated flow", async () => {
  const source = await readFile(
    new URL("app/que-auto-me-llevo/page.tsx", root),
    "utf8",
  );
  assert.match(source, /AffordabilityFlow/);
  assert.doesNotMatch(source, /LeadForm|mode=["']finder["']/);
});
