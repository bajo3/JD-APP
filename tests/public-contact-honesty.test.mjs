import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const PUBLIC_SOURCES = [
  "app/page.tsx",
  "app/stock/page.tsx",
  "app/autos/[slug]/page.tsx",
  "app/oferta-del-dia/page.tsx",
  "app/contacto/page.tsx",
  "app/tasar-mi-usado/page.tsx",
  "app/que-auto-me-llevo/page.tsx",
  "app/offline/page.tsx",
  "app/simulaciones/[codigo]/page.tsx",
  "app/_components/PublicShell.tsx",
  "app/_components/PublicHeader.tsx",
  "app/_components/PublicFooter.tsx",
  "app/_components/BottomNav.tsx",
];

const SHELL_PAGES = [
  "app/stock/page.tsx",
  "app/autos/[slug]/page.tsx",
  "app/oferta-del-dia/page.tsx",
  "app/contacto/page.tsx",
  "app/tasar-mi-usado/page.tsx",
  "app/que-auto-me-llevo/page.tsx",
  "app/offline/page.tsx",
  "app/simulaciones/[codigo]/page.tsx",
];

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("no public surface hardcodes a phone number, WhatsApp link or address", async () => {
  for (const path of PUBLIC_SOURCES) {
    const source = await read(path);
    assert.doesNotMatch(source, /wa\.me\/\d/, path);
    assert.doesNotMatch(source, /tel:\+?\d/, path);
    assert.doesNotMatch(source, /\+?54\s?9?\s?249/, path);
    assert.doesNotMatch(source, /Piedrabuena/, path);
  }
});

test("contact entry points fall back to the form when WhatsApp is not configured", async () => {
  const helper = await read("app/_components/contact.ts");
  assert.match(helper, /if \(!profile\?\.whatsappE164\) return "\/contacto"/);
  assert.match(helper, /if \(!digits\) return "\/contacto"/);

  for (const path of [
    "app/_components/PublicHeader.tsx",
    "app/_components/PublicFooter.tsx",
    "app/_components/BottomNav.tsx",
  ]) {
    const source = await read(path);
    assert.match(source, /profile: PublicProfileView \| null/, path);
    assert.match(source, /contactHref|Link href="\/contacto"/, path);
  }
});

test("every public page exposes the skip link target", async () => {
  const shell = await read("app/_components/PublicShell.tsx");
  assert.match(shell, /className="skip-link" href="#contenido"/);

  const home = await read("app/page.tsx");
  assert.match(home, /className="skip-link" href="#contenido"/);
  assert.match(home, /<main id="contenido">/);

  for (const path of SHELL_PAGES) {
    const source = await read(path);
    assert.match(source, /<main id="contenido"/, path);
  }
});

test("the offline shell never reads the business profile", async () => {
  const shell = await read("app/_components/PublicShell.tsx");
  assert.match(shell, /export function StaticPublicShell/);
  const offline = await read("app/offline/page.tsx");
  assert.match(offline, /StaticPublicShell/);
  assert.doesNotMatch(offline, /<PublicShell>/);
  assert.doesNotMatch(offline, /getPublicProfile|getDataAccess/);
});

test("structured data is escaped and only published for confirmed records", async () => {
  const source = await read("app/_components/JsonLd.tsx");
  assert.match(source, /replace\(\/<\/g, "\\\\u003c"\)/);
  assert.match(source, /if \(!profile\) return null/);
  assert.match(source, /if \(demo\) return null/);
  assert.match(source, /priceCurrency: "ARS"/);
  assert.doesNotMatch(source, /InStock[\s\S]{0,80}CHECK_AVAILABILITY/);
});

test("the sitemap lists published stock and never operation codes", async () => {
  const source = await read("app/sitemap.ts");
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /listAvailable\(\)/);
  assert.match(code, /\/autos\/\$\{vehicle\.slug\}/);
  assert.doesNotMatch(code, /simulaciones|offline|panel/i);

  const robots = await read("app/robots.ts");
  assert.match(robots, /disallow:\s*\["\/panel","\/api\/"\]/);
});
