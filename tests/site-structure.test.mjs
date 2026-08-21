import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the starter preview was fully replaced by the JD experience", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(page, /¿Qué auto te podés llevar[\s\S]*hoy\?/);
  assert.match(page, /Jesús Díaz/);
  assert.match(layout, /lang="es"/);
  assert.match(layout, /Jesús Díaz Automotores/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)),
  );
});

test("the six public V1 surfaces and PWA metadata exist", async () => {
  const files = [
    "app/stock/page.tsx",
    "app/autos/[slug]/page.tsx",
    "app/tasar-mi-usado/page.tsx",
    "app/que-auto-me-llevo/page.tsx",
    "app/oferta-del-dia/page.tsx",
    "app/contacto/page.tsx",
    "app/simulaciones/[codigo]/page.tsx",
    "app/manifest.ts",
    "app/robots.ts",
    "app/sitemap.ts",
  ];

  await Promise.all(files.map((file) => access(new URL(file, root))));
});

test("consignación (V1.1) existe como ruta pero no se navega ni se anuncia en la V1", async () => {
  await access(new URL("app/consignar-mi-auto/page.tsx", root));

  const header = await readFile(new URL("app/_components/PublicHeader.tsx", root), "utf8");
  assert.doesNotMatch(header, /consignar-mi-auto/);

  const home = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.doesNotMatch(home, /consignar-mi-auto/);

  const sitemap = await readFile(new URL("app/sitemap.ts", root), "utf8");
  assert.doesNotMatch(sitemap, /consignar-mi-auto/);

  // La página directa es honesta sobre su estado: capacidad opcional en
  // revisión, sin indexación hasta aprobación comercial.
  const page = await readFile(new URL("app/consignar-mi-auto/page.tsx", root), "utf8");
  assert.match(page, /Capacidad opcional en revisión/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});
