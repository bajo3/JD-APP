import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pages = [
  "app/panel/stock/page.tsx",
  "app/panel/leads/page.tsx",
  "app/panel/tasaciones/page.tsx",
  "app/panel/tasaciones/referencias/page.tsx",
  "app/panel/financiacion/page.tsx",
  "app/panel/ofertas/page.tsx",
].map((path) => readFileSync(path, "utf8")).join("\n");

test("panel server pages pass only serializable action descriptors", () => {
  assert.doesNotMatch(pages, /body\s*:\s*(?:\([^)]*\)|\w+)\s*=>/);
  assert.match(pages, /actions=\{/);
  assert.match(pages, /expectedVersion|AdminTable/);
});

test("admin forms use exact protected endpoints and stable create keys", () => {
  const source = readFileSync("app/panel/_components/AdminResourceForm.tsx", "utf8");
  for (const endpoint of ["vehicles", "leads", "appraisals", "consignments", "finance-plans", "promotions", "appraisal-rulesets"]) {
    assert.match(source, new RegExp(`/api/v1/admin/${endpoint}`));
  }
  assert.match(source, /idempotencyKey\.current \?\?=/);
  assert.match(source, /normalConditionsSnapshot:\s*\{\s*normalPriceCents/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /JSON\.parse\(value\("rulesJson"\)\)/);
});

test("row actions send lowercase contract actions and optimistic versions", () => {
  const source = readFileSync("app/panel/_components/AdminTable.tsx", "utf8");
  assert.match(source, /expectedVersion:\s*Number\(row\.version\)/);
  assert.match(pages, /action:"archive"/);
  assert.match(pages, /action:"publish"/);
  assert.match(pages, /action:"pause"/);
  assert.doesNotMatch(pages, /action:"(?:ARCHIVAR|PUBLICAR|PAUSAR)"/);
});
