import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationContractError,
  normalizeArs,
  normalizeSearchRequest,
  normalizeVehicleRecord,
} from "../lib/application/index.mjs";
import { normalizePromotionRecord } from "../lib/application/normalizers.mjs";

test("application money contracts accept explicit ARS units and reject floats", () => {
  assert.equal(normalizeArs("123.45", "cash").minorUnits, 12_345);
  assert.equal(
    normalizeArs({ currency: "ARS", minorUnits: "12345" }, "cash").minorUnits,
    12_345,
  );
  assert.equal(normalizeArs(12_345, "cashCents", "minor").minorUnits, 12_345);
  assert.throws(
    () => normalizeArs(123.45, "cash"),
    (error) => error instanceof ApplicationContractError && error.code === "invalid_money",
  );
  assert.throws(
    () => normalizeArs({ currency: "USD", minorUnits: 100 }, "cash"),
    /no es ARS válido/,
  );
});

test("request normalization fixes dates, appraisal scenarios and defaults", () => {
  const request = normalizeSearchRequest(
    {
      cashArs: "4000000",
      maxMonthlyPaymentCents: 125_000_000,
      acceptedTerms: [24, 12, 24],
      appraisal: {
        lowCents: 1_650_000_000,
        baseCents: 1_750_000_000,
        highCents: 1_820_000_000,
        certaintyLevel: "T1",
        validUntil: "2026-08-18T00:00:00-03:00",
      },
    },
    () => new Date("2026-08-16T12:00:00-03:00"),
  );
  assert.equal(request.at, "2026-08-16T15:00:00.000Z");
  assert.deepEqual(request.acceptedTerms, [12, 24]);
  assert.equal(request.accreditedDeposit.minorUnits, 0);
  assert.equal(request.appraisal.certainty, "T1");
  assert.equal(request.appraisal.validUntil, "2026-08-18T03:00:00.000Z");
});

test("database-shaped stock records normalize into domain stock", () => {
  const vehicle = normalizeVehicleRecord(
    {
      id: "veh-db",
      slug: "fiat-cronos-2023",
      make: "Fiat",
      model: "Cronos",
      trim: "Drive",
      year: 2023,
      bodyType: "Sedán",
      status: "AVAILABLE",
      priceCents: 2_490_000_000,
      lastSyncedAt: "2026-08-16T14:00:00.000Z",
    },
    { evaluatedAt: "2026-08-16T15:00:00.000Z", stockFreshnessMinutes: 1_440 },
  );
  assert.equal(vehicle.brand, "Fiat");
  assert.equal(vehicle.model, "Cronos Drive");
  assert.equal(vehicle.type, "car");
  assert.equal(vehicle.price.minorUnits, 2_490_000_000);
  assert.equal(vehicle.validUntil, "2026-08-17T14:00:00.000Z");
});

test("database-shaped promotion versions normalize into stable string identifiers", () => {
  const promotion = normalizePromotionRecord({
    id: "promo-demo-dia",
    version: 1,
    status: "ACTIVE",
    type: "PRICE_DISCOUNT",
    discountCents: 100_000_000,
    vehicleIds: ["veh-tcross-2022"],
    startsAt: "2026-08-16T14:00:00.000Z",
    endsAt: "2026-08-17T14:00:00.000Z",
  });

  assert.equal(promotion.version, "1");
});
