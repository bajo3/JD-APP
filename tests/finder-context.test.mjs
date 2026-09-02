import assert from "node:assert/strict";
import test from "node:test";

import { resolveFinderVehicleContext } from "../lib/server/finder-context.ts";

function stockReturning(vehicle) {
  return {
    calls: [],
    async findBySlug(slug) {
      this.calls.push(slug);
      return vehicle;
    },
  };
}

test("finder context resolves identity only from an AVAILABLE server record", async () => {
  const stock = stockReturning({
    id: "vehicle-1",
    slug: "toyota-corolla-xei-2022",
    make: "Toyota",
    model: "Corolla",
    trim: "XEI",
    status: "AVAILABLE",
    currency: "ARS",
  });

  const result = await resolveFinderVehicleContext(
    "toyota-corolla-xei-2022",
    stock,
  );

  assert.deepEqual(result, {
    id: "vehicle-1",
    slug: "toyota-corolla-xei-2022",
    name: "Toyota Corolla XEI",
  });
  assert.deepEqual(stock.calls, ["toyota-corolla-xei-2022"]);
});

test("finder context ignores malformed, repeated and unavailable URL hints", async () => {
  const unavailable = stockReturning({
    id: "vehicle-2",
    slug: "unidad-archivada",
    make: "Renault",
    model: "Sandero",
    trim: null,
    status: "ARCHIVED",
    currency: "ARS",
  });
  const malformed = stockReturning(null);

  assert.equal(await resolveFinderVehicleContext(["a", "b"], malformed), null);
  assert.equal(await resolveFinderVehicleContext("../../interno", malformed), null);
  assert.deepEqual(malformed.calls, []);
  assert.equal(await resolveFinderVehicleContext("unidad-archivada", unavailable), null);
  assert.deepEqual(unavailable.calls, ["unidad-archivada"]);
});

test("finder context ignores a unit quoted in a currency the tarifario cannot price", async () => {
  const usd = stockReturning({
    id: "vehicle-3",
    slug: "baic-bj-30-4x4-2026",
    make: "BAIC",
    model: "BJ 30",
    trim: "4X4",
    status: "AVAILABLE",
    currency: "USD",
  });

  assert.equal(await resolveFinderVehicleContext("baic-bj-30-4x4-2026", usd), null);
  assert.deepEqual(usd.calls, ["baic-bj-30-4x4-2026"]);
});
