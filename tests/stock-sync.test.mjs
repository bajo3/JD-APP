import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hashPayload,
  mapSheetUnits,
  normalizeTransmission,
  parsePriceCell,
  parseSheet,
  photoKind,
  planStockSync,
  publicSlug,
  resolveRuntime,
} from "../scripts/stock-sync.mjs";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

const sheet = (rows) => rows.map((cells) => cells.join(TAB)).join(LF);

test("el precio conserva la moneda que declara la planilla", () => {
  const dolares = parsePriceCell("34.500 USD");
  assert.deepEqual(
    { ok: dolares.ok, currency: dolares.currency, cents: dolares.cents },
    { ok: true, currency: "USD", cents: 3_450_000 },
  );

  const pesos = parsePriceCell("$22.300.000");
  assert.deepEqual(
    { ok: pesos.ok, currency: pesos.currency, cents: pesos.cents },
    { ok: true, currency: "ARS", cents: 2_230_000_000 },
  );

  assert.equal(parsePriceCell("U$S 18.900").currency, "USD");
  assert.equal(parsePriceCell("18.900 dólares").currency, "USD");
});

test("un precio que no permite decidir se rechaza en lugar de adivinarse", () => {
  // Sin símbolo no hay forma de saber si son pesos o dólares: publicar el
  // número solo convertiría un usado en dólares en una ganga imposible.
  assert.deepEqual(parsePriceCell("22300000").reason, "moneda_no_declarada");
  assert.equal(parsePriceCell("$!4000000").reason, "precio_ilegible");
  assert.equal(parsePriceCell("   ").reason, "precio_vacio");
  assert.equal(parsePriceCell("$ 5").reason, "precio_placeholder");
  assert.equal(parsePriceCell("a convenir").reason, "moneda_no_declarada");
});

test("la planilla se lee por encabezado y la marca baja desde su fila", () => {
  const rows = parseSheet(
    sheet([
      ["UNIDAD", "AÑO", "KM", "VERSION", "PRECIO LISTA", "PRECIO CONTADO"],
      ["CHEVROLET", "", "", "", "", ""],
      ["CRUZE", "2019", "78.500", "LT", "$22.300.000", "$21.000.000"],
      ["CRUZE", "2019", "91.000", "LT", "$21.900.000", ""],
      ["", "", "", "", "", ""],
    ]),
  );
  assert.equal(rows[1].precio_lista, "$22.300.000");

  const units = mapSheetUnits(rows);
  assert.equal(units.length, 2);
  assert.equal(units[0].brand, "CHEVROLET");
  assert.equal(units[0].unitId, "chevrolet_cruze_lt_2019");
  // Dos unidades iguales no pueden compartir la llave contra JD-Auto.
  assert.equal(units[1].unitId, "chevrolet_cruze_lt_2019_2");
  assert.equal(units[0].km, 78_500);
  assert.equal(units[0].year, 2019);
});

const unidad = (overrides = {}) => ({
  unitId: "chevrolet_cruze_lt_2019",
  sheetRow: 4,
  brand: "CHEVROLET",
  model: "CRUZE",
  version: "LT",
  year: 2019,
  km: 78_500,
  color: "GRIS",
  fuel: "NAFTA",
  traction: "",
  transmission: "AT",
  engine: "1.4",
  listPrice: parsePriceCell("$22.300.000"),
  cashPrice: parsePriceCell("$21.000.000"),
  ...overrides,
});

const ficha = (overrides = {}) => ({
  id: "veh-1",
  unit_id: "chevrolet_cruze_lt_2019",
  status: "active",
  vehicle_photos: [
    { url: "https://jd-auto/foto/b.jpg?kind=raw", position: 2 },
    { url: "https://jd-auto/foto/a.jpg?kind=raw", position: 1 },
    { url: "https://jd-auto/foto/redes.jpg?kind=edited", position: 0 },
  ],
  ...overrides,
});

test("una unidad completa se publica con su moneda, su slug y sus fotos originales", () => {
  const { accepted, rejected } = planStockSync({ units: [unidad()], vehicles: [ficha()] });
  assert.equal(rejected.length, 0);
  assert.equal(accepted.length, 1);

  const [publicada] = accepted;
  assert.equal(publicada.record.currency, "ARS");
  assert.equal(publicada.record.priceCents, 2_230_000_000);
  assert.equal(publicada.record.slug, "chevrolet-cruze-lt-2019");
  assert.equal(publicada.record.make, "Chevrolet");
  assert.equal(publicada.record.transmission, "Automática");
  // La planilla no informa carrocería: se publica el tipo neutro en lugar de
  // deducirlo del modelo (DECISIONES_JDA #11).
  assert.equal(publicada.record.bodyType, "auto");
  // Las piezas editadas son para redes; la ficha lleva las originales, en orden.
  assert.deepEqual(
    publicada.photos.map((photo) => photo.fileName),
    ["a.jpg", "b.jpg"],
  );
});

test("nada incompleto llega a la web y cada rechazo dice por qué", () => {
  const casos = [
    [unidad(), [], "sin_ficha_en_jd_auto"],
    [unidad(), [ficha({ status: "sold" })], "no_activa_en_jd_auto"],
    [unidad({ listPrice: parsePriceCell("22300000") }), [ficha()], "moneda_no_declarada"],
    [unidad({ year: null }), [ficha()], "sin_anio"],
    [unidad({ km: null }), [ficha()], "sin_kilometraje"],
    [unidad({ version: "" }), [ficha()], "sin_version"],
    [
      unidad(),
      [ficha({ vehicle_photos: [{ url: "https://jd-auto/foto/redes.jpg?kind=edited", position: 0 }] })],
      "sin_fotos_originales",
    ],
  ];

  for (const [unit, vehicles, reason] of casos) {
    const { accepted, rejected } = planStockSync({ units: [unit], vehicles });
    assert.equal(accepted.length, 0, `${reason} no debería publicarse`);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, reason);
    assert.equal(rejected[0].sheetRow, unit.sheetRow);
  }
});

test("el tope de fotos y la huella del payload acompañan al cambio", () => {
  const fotos = Array.from({ length: 5 }, (_, index) => ({
    url: `https://jd-auto/foto/${index}.jpg?kind=raw`,
    position: index,
  }));
  const { accepted } = planStockSync({
    units: [unidad()],
    vehicles: [ficha({ vehicle_photos: fotos })],
    photoLimit: 3,
  });
  assert.equal(accepted[0].photos.length, 3);
  assert.deepEqual(
    accepted[0].photos.map((photo) => photo.sortOrder),
    [0, 1, 2],
  );

  const otroPrecio = planStockSync({
    units: [unidad({ listPrice: parsePriceCell("$24.000.000") })],
    vehicles: [ficha()],
  });
  const mismo = planStockSync({ units: [unidad()], vehicles: [ficha()] });
  assert.notEqual(otroPrecio.accepted[0].payloadHash, mismo.accepted[0].payloadHash);
  assert.equal(mismo.accepted[0].payloadHash, hashPayload({ ...mismo.accepted[0].record, photos: ["a.jpg", "b.jpg"] }));
});

test("las piezas editadas y la caja se clasifican sin adivinar", () => {
  assert.equal(photoKind("https://x/y.jpg?kind=raw"), "raw");
  assert.equal(photoKind("https://x/y.jpg?kind=marketplace_edited"), "edited");
  assert.equal(photoKind("https://x/y.jpg"), "unknown");
  assert.equal(normalizeTransmission("MT"), "Manual");
  assert.equal(normalizeTransmission("automatica"), "Automática");
  assert.equal(normalizeTransmission("CVT"), "CVT");
  assert.equal(publicSlug("chevrolet_cruze_lt_2019_2"), "chevrolet-cruze-lt-2019-2");
});

test("resolveRuntime propaga --dry-run, --skip-photos y --photos: escribir de más aquí haría que --dry-run escriba en Supabase igual que --confirm-remote", () => {
  const jdAutoDir = mkdtempSync(join(tmpdir(), "jda-jd-auto-fixture-"));
  const previousEnv = {
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    SUPABASE_STORAGE_ENDPOINT: process.env.SUPABASE_STORAGE_ENDPOINT,
    SUPABASE_STORAGE_REGION: process.env.SUPABASE_STORAGE_REGION,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
    SUPABASE_STORAGE_ACCESS_KEY_ID: process.env.SUPABASE_STORAGE_ACCESS_KEY_ID,
    SUPABASE_STORAGE_SECRET_ACCESS_KEY: process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY,
  };
  try {
    writeFileSync(
      join(jdAutoDir, ".env"),
      [
        "SUPABASE_URL=https://fixture.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=fixture-key",
        "SHEET_TSV_URL=https://fixture.example/sheet?output=csv",
      ].join("\n"),
    );
    process.env.SUPABASE_DB_URL = "postgresql://fixture:fixture@localhost:5432/fixture";
    process.env.SUPABASE_STORAGE_ENDPOINT = "https://fixture.storage.supabase.co/storage/v1/s3";
    process.env.SUPABASE_STORAGE_REGION = "us-west-2";
    process.env.SUPABASE_STORAGE_BUCKET = "fixture-bucket";
    process.env.SUPABASE_STORAGE_ACCESS_KEY_ID = "fixture-access-key";
    process.env.SUPABASE_STORAGE_SECRET_ACCESS_KEY = "fixture-secret-key";

    const runtime = resolveRuntime(
      { remote: true, confirmRemote: true, dryRun: true, skipPhotos: true, photoLimit: 7, jdAutoDir },
      "/fixture-project-root",
    );
    assert.equal(runtime.dryRun, true);
    assert.equal(runtime.skipPhotos, true);
    assert.equal(runtime.photoLimit, 7);
    assert.equal(runtime.sheetUrl, "https://fixture.example/sheet?output=tsv");
  } finally {
    rmSync(jdAutoDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
