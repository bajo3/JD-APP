import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const panelRoot = new URL("../app/panel/", import.meta.url);

test("panel layout is dynamic and guarded before rendering children", async () => {
  const layout = await readFile(new URL("layout.tsx", panelRoot), "utf8");
  assert.match(layout, /export const dynamic = ["']force-dynamic["']/);
  assert.match(layout, /await requirePanelUser\(["']\/panel["']\)/);
  assert.ok(
    layout.indexOf("await requirePanelUser") < layout.indexOf("{children}"),
    "authorization must happen before protected children are rendered",
  );
  assert.match(layout, /error instanceof PanelAccessError/);
});

test("panel does not implement custom sign-in or callback routes", async () => {
  const files = await readdir(panelRoot, { recursive: true });
  assert.ok(files.includes("layout.tsx"));
  assert.ok(files.includes("protected-state.tsx"));
  assert.equal(
    files.some((file) => /(?:sign-?in|callback)/i.test(file)),
    false,
  );
  const state = await readFile(new URL("protected-state.tsx", panelRoot), "utf8");
  assert.match(state, /LogoutButton/);
  assert.doesNotMatch(state, /chatGPTSignOutPath/);
  assert.doesNotMatch(state, /callback|password|token|cookie/i);
});
