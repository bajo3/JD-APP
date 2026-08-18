import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the valuation form offers the six guided photo slots and client-side re-encoding", async () => {
  const source = await readFile(new URL("app/_components/LeadForm.tsx", root), "utf8");
  for (const capture of ["FRONT", "REAR", "SIDE_LEFT", "SIDE_RIGHT", "INTERIOR", "DASHBOARD"]) {
    assert.match(source, new RegExp(`type:"${capture}"`));
  }
  assert.match(source, /createImageBitmap/);
  assert.match(source, /\/photos/);
  assert.match(source, /X-Capture-Type/);
  assert.doesNotMatch(source, /Idempotency-Key:\s*undefined/);
});

test("the public photo route exposes only POST", async () => {
  const source = await readFile(new URL("app/api/v1/appraisals/[code]/photos/route.ts", root), "utf8");
  assert.match(source, /export async function POST/);
  assert.doesNotMatch(source, /export async function GET/);
});

test("the panel keeps appraisal photos behind the private detail page", async () => {
  const detail = await readFile(new URL("app/panel/tasaciones/[id]/page.tsx", root), "utf8");
  assert.match(detail, /getAdminAppraisalDetailData/);
  assert.match(detail, /photo\.url/);
  assert.match(detail, /Fotos del usado/);
  assert.match(detail, /appraisal-photo-grid/);

  const list = await readFile(new URL("app/panel/tasaciones/page.tsx", root), "utf8");
  assert.match(list, /linkBase:"\/panel\/tasaciones\/"/);
});

test("private photo delivery uses the admin route with no-store semantics", async () => {
  const source = await readFile(
    new URL("lib/server/appraisal-media.ts", root),
    "utf8",
  );
  assert.match(source, /private, no-store/);
  assert.match(source, /putPrivateAppraisalImage/);
  assert.match(source, /stripImageMetadata/);
});
