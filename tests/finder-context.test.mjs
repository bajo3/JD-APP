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
  });
  const malformed = stockReturning(null);

  assert.equal(await resolveFinderVehicleContext(["a", "b"], malformed), null);
  assert.equal(await resolveFinderVehicleContext("../../interno", malformed), null);
  assert.deepEqual(malformed.calls, []);
  assert.equal(await resolveFinderVehicleContext("unidad-archivada", unavailable), null);
  assert.deepEqual(unavailable.calls, ["unidad-archivada"]);
});
