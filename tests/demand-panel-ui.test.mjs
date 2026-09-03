import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("la pantalla de demanda dice que el aviso lo manda una persona", async () => {
  const source = await read("app/panel/demandas/page.tsx");
  assert.match(source, /El sistema prepara el mensaje; lo manda una persona/);
  assert.match(source, /Ninguna de estas coincidencias salió\s*\n?\s*todavía al cliente/);
  // No hay ningún botón de envío en la pantalla: el borrador se lee y se copia.
  assert.doesNotMatch(source, /Enviar|onClick|fetch\(/);
});

test("el tablero declara lo no medido en vez de rellenarlo", async () => {
  const source = await read("app/panel/demandas/page.tsx");
  assert.match(source, /Sin declarar:/);
  assert.match(source, /No se estiman: nadie los dijo/);
  assert.match(source, /Todavía no hay demandas registradas y vigentes/);
});

test("cada coincidencia muestra por qué coincide y por qué no", async () => {
  const source = await read("app/panel/demandas/page.tsx");
  assert.match(source, /match\.scorePercent/);
  assert.match(source, /Cumple:/);
  assert.match(source, /No cumple:/);
  assert.match(source, /sin vendedor asignado/);
});

test("la demanda entra en la navegación del panel", async () => {
  const shell = await read("app/panel/_components/PanelShell.tsx");
  assert.match(shell, /'\/panel\/demandas','Demanda'/);
});

test("la pantalla exige sesión del panel antes de leer nada", async () => {
  const data = await read("lib/server/demand-panel-data.ts");
  const guard = data.indexOf("await requirePanelUser()");
  const query = data.indexOf(".select({");
  assert.ok(guard >= 0, "sin guard no se sirve el tablero");
  assert.ok(query >= 0, "la pantalla consulta la base");
  assert.ok(guard < query, "el guard corre antes de tocar la base");
});

test("el panel sólo lista coincidencias que nadie avisó todavía", async () => {
  const data = await read("lib/server/demand-panel-data.ts");
  assert.match(data, /eq\(demandMatches\.status, "NEW"\)/);
});

test("las clases nuevas del panel existen en la hoja de estilos", async () => {
  const css = await read("app/globals.css");
  for (const className of [
    ".demand-buckets",
    ".demand-matches",
    ".demand-list",
    ".demand-draft",
    ".demand-match-head",
  ]) {
    assert.ok(css.includes(className), `falta ${className}`);
  }
});
