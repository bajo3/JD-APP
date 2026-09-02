import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FINANCEABLE_CURRENCY,
  isFinanceableCurrency,
  moneyFromMajor,
  moneyFromMinor,
} from "../lib/domain/index.mjs";
import { normalizeVehicleRecord } from "../lib/application/normalizers.mjs";
import {
  AdminError,
  createAdminVehicle,
  editAdminVehicle,
  transitionAdminVehicle,
} from "../lib/admin/index.ts";

const root = new URL("../", import.meta.url);
const NOW = new Date("2026-08-25T15:00:00.000Z");
const actor = Object.freeze({
  userId: "operator-1",
  email: "operator@example.com",
  displayName: "Operador",
});

function vehicle(overrides = {}) {
  return {
    id: "vehicle-usd",
    slug: "baic-bj-30-4x4-2026",
    externalCode: "baic_bj_30_4_x_4",
    make: "BAIC",
    model: "BJ 30",
    trim: "4X4",
    year: 2026,
    mileageKm: 0,
    priceCents: 37_200_00,
    currency: "USD",
    priceValidUntil: null,
    bodyType: "suv",
    fuelType: "nafta",
    transmission: "automatica",
    color: "gris",
    status: "DRAFT",
    source: "jd-auto",
    internalNotes: null,
    version: 1,
    publishedAt: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  let generated = 0;
  return {
    authorize: async () => actor,
    clock: () => new Date(NOW),
    idGenerator: () => `generated-${++generated}`,
    repositories: {
      stock: {
        async findById() { return vehicle(); },
        async create(input) { return { ok: true, record: { ...vehicle(), ...input } }; },
        async update(input) {
          return { ok: true, record: vehicle({ ...input.patch, version: input.expectedVersion + 1 }) };
        },
        async transition(input) {
          return { ok: true, record: vehicle({ status: input.nextStatus, version: input.expectedVersion + 1 }) };
        },
      },
    },
    ...overrides,
  };
}

test("el dinero conserva su moneda y nunca mezcla pesos con dólares", () => {
  const pesos = moneyFromMajor("31500000", "ARS");
  const dolares = moneyFromMajor("37200", "USD");

  assert.equal(pesos.currency, "ARS");
  assert.equal(dolares.currency, "USD");
  assert.equal(dolares.minorUnits, 3_720_000);
  assert.throws(() => pesos.add(dolares), RangeError);
  assert.throws(() => moneyFromMinor(1_000, "EUR"), RangeError);
});

test("sólo las unidades en pesos son financiables: el tarifario se publica en ARS", () => {
  assert.equal(FINANCEABLE_CURRENCY, "ARS");
  assert.equal(isFinanceableCurrency("ARS"), true);
  assert.equal(isFinanceableCurrency("USD"), false);
});

test("el panel publica una unidad en dólares y rechaza una moneda no admitida", async () => {
  const deps = dependencies();
  const created = await createAdminVehicle(deps, {
    idempotencyKey: "sync-baic-bj30-4x4",
    slug: "baic-bj-30-4x4-2026",
    externalCode: "baic_bj_30_4_x_4",
    make: "BAIC",
    model: "BJ 30",
    trim: "4X4",
    year: 2026,
    mileageKm: 0,
    priceCents: 37_200_00,
    currency: "USD",
    bodyType: "suv",
    fuelType: "nafta",
    transmission: "automatica",
    color: "gris",
    source: "jd-auto",
  });
  assert.equal(created.currency, "USD");
  assert.equal(created.priceCents, 3_720_000);

  const published = await transitionAdminVehicle(dependencies(), {
    id: "vehicle-usd",
    expectedVersion: 1,
    nextStatus: "AVAILABLE",
  });
  assert.equal(published.status, "AVAILABLE");

  await assert.rejects(
    () => editAdminVehicle(dependencies(), {
      id: "vehicle-usd",
      expectedVersion: 1,
      patch: { currency: "EUR" },
    }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_INPUT",
  );
});

test("el motor rechaza cotizar una unidad que no está en pesos", () => {
  const context = { evaluatedAt: NOW.toISOString(), stockFreshnessMinutes: 1_440 };
  assert.throws(
    () => normalizeVehicleRecord(
      {
        id: "vehicle-usd",
        slug: "baic-bj-30-4x4-2026",
        make: "BAIC",
        model: "BJ 30",
        trim: "4X4",
        year: 2026,
        bodyType: "suv",
        status: "AVAILABLE",
        currency: "USD",
        priceCents: 3_720_000,
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
      context,
    ),
    (error) => error.code === "unsupported_currency",
  );
});

test("el buscador y la simulación dejan fuera la unidad no financiable", async () => {
  const [affordability, simulation, finder] = await Promise.all([
    readFile(new URL("lib/server/affordability.ts", root), "utf8"),
    readFile(new URL("lib/server/simulation-api.ts", root), "utf8"),
    readFile(new URL("lib/server/finder-context.ts", root), "utf8"),
  ]);
  assert.match(affordability, /vehicles: vehicles\.filter\(isFinanceableVehicle\)/);
  assert.match(simulation, /VEHICLE_NOT_FINANCEABLE/);
  assert.match(finder, /isFinanceableCurrency\(vehicle\.currency\)/);
});

test("la ficha publica el precio en su moneda y no ofrece simular lo que no puede cotizar", async () => {
  const [publicData, detail] = await Promise.all([
    readFile(new URL("lib/server/public-data.ts", root), "utf8"),
    readFile(new URL("app/autos/[slug]/page.tsx", root), "utf8"),
  ]);
  assert.match(publicData, /price: formatMoney\(dto\.price\.cents, dto\.price\.currency\)/);
  assert.match(publicData, /financeable: isFinanceableCurrency\(dto\.price\.currency\)/);
  assert.match(detail, /vehicle\.financeable \? \(/);
  assert.match(detail, /Consultar financiación/);
});

test("la galería recorre las fotos sin estado de cliente", async () => {
  const [gallery, detail, styles] = await Promise.all([
    readFile(new URL("app/_components/VehicleGallery.tsx", root), "utf8"),
    readFile(new URL("app/autos/[slug]/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.doesNotMatch(gallery, /"use client"/);
  assert.doesNotMatch(gallery, /useState|useEffect/);
  assert.match(gallery, /aria-label=\{`Ver foto \$\{index \+ 1\} de \$\{images\.length\}`\}/);
  assert.match(detail, /vehicle\.images\.length > 1/);
  assert.match(styles, /scroll-snap-type:x mandatory/);
  assert.match(styles, /\.gallery-thumbs a\{[^}]*height:57px/);
});
