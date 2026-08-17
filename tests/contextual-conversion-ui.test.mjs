import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("vehicle detail and daily offer lead with a contextual simulation CTA", async () => {
  const [detail, offer] = await Promise.all([
    source("app/autos/[slug]/page.tsx"),
    source("app/oferta-del-dia/page.tsx"),
  ]);

  assert.match(detail, /que-auto-me-llevo\?vehiculo=\$\{encodeURIComponent\(vehicle\.slug\)\}/);
  assert.match(detail, /Simular esta unidad/);
  assert.match(detail, /Consultar por WhatsApp/);
  assert.ok(detail.indexOf("Simular esta unidad") < detail.indexOf("Consultar por WhatsApp"));

  assert.match(offer, /que-auto-me-llevo\?vehiculo=\$\{encodeURIComponent\(offer\.vehicle\.slug\)\}/);
  assert.match(offer, /Calcular esta oferta con mi usado/);
  assert.ok(offer.indexOf("Calcular esta oferta con mi usado") < offer.indexOf("Consultar ahora"));
});

test("finder resolves the URL hint on the server before serializing context", async () => {
  const finder = await source("app/que-auto-me-llevo/page.tsx");

  assert.match(finder, /searchParams:\s*Promise/);
  assert.match(finder, /const \{ vehiculo \} = await searchParams/);
  assert.match(finder, /resolveFinderVehicleContext\(vehiculo, access\.stock\)/);
  assert.match(finder, /initialVehicle=\{initialVehicle\}/);
});

test("affordability UI prioritizes only the authoritative matching result", async () => {
  const flow = await source("app/_components/AffordabilityFlow.tsx");

  assert.match(flow, /prioritizeContextualResult\(searchData\.results, initialVehicle\)/);
  assert.match(flow, /result\.vehicle\.id === initialVehicle\.id/);
  assert.match(flow, /result\.vehicle\.slug === initialVehicle\.slug/);
  assert.match(flow, /El que elegiste/);
  assert.match(flow, /ya no aparece entre las opciones vigentes/);
  assert.match(flow, /no entra con estos datos/);
  assert.match(flow, /simulationCode: simulation\.code/);
  assert.match(flow, /vehicleSlug: selected\.vehicle\.slug/);
});

test("lead list exposes a serializable route to the protected detail", async () => {
  const [list, table, detail] = await Promise.all([
    source("app/panel/leads/page.tsx"),
    source("app/panel/_components/AdminTable.tsx"),
    source("app/panel/leads/[id]/page.tsx"),
  ]);

  assert.match(list, /linkBase:"\/panel\/leads\/"/);
  assert.match(table, /linkBase\?: string/);
  assert.match(table, /encodeURIComponent\(String\(row\.id\)\)/);
  assert.match(detail, /getAdminLeadDetailData\(id\)/);
  assert.match(detail, /operation\.amounts/);
  assert.match(detail, /operation\.disclaimer/);
  assert.match(detail, /operation\.validity === "EXPIRED"/);
  assert.match(detail, /lead\.events\.map/);
});
