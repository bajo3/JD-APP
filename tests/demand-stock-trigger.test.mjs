import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const handlers = await readFile(new URL("lib/server/admin-handlers.ts", root), "utf8");

test("publicar una unidad dispara el cruce con las demandas", async () => {
  const transition = handlers.indexOf("await transitionAdminVehicle(");
  const trigger = handlers.indexOf("await recordDemandMatches(vehicle)");
  assert.ok(transition >= 0 && trigger >= 0);
  assert.ok(transition < trigger, "primero se publica, después se cruza");
  assert.match(
    handlers,
    /if \(vehicle\.status === "AVAILABLE"\) await recordDemandMatches/,
    "sólo al publicar: pausar o archivar no cruza nada",
  );
});

test("el cruce no puede hacer fallar la publicación de una unidad", async () => {
  const start = handlers.indexOf("async function recordDemandMatches");
  const end = handlers.indexOf("export function adminVehicle(request: Request, id: string)");
  const body = handlers.slice(start, end);
  assert.ok(body.includes("try {") && body.includes("} catch (error) {"));
  assert.match(body, /console\.error\("demand_match_failed"/);
  assert.doesNotMatch(body, /throw/, "un fallo del cruce no vuelve a lanzarse");
});

test("el cruce guarda coincidencias y no le escribe a ningún cliente", async () => {
  const service = await readFile(new URL("lib/server/demand-matching-service.ts", root), "utf8");
  assert.match(service, /sin avisarle a nadie/);
  // El servicio no importa el circuito de salida: no tiene con qué mandar nada.
  assert.doesNotMatch(service, /sendOutboundMessage|ZernioClient/);
  const start = handlers.indexOf("async function recordDemandMatches");
  const end = handlers.indexOf("export function adminVehicle(request: Request, id: string)");
  assert.doesNotMatch(handlers.slice(start, end), /sendOutboundMessage|notify/i);
});

test("el servicio de cruce se carga sólo cuando hace falta", async () => {
  assert.match(
    handlers,
    /await import\("\.\/demand-matching-service"\)/,
    "import dinámico: el panel de stock no arrastra el motor de demanda",
  );
});
