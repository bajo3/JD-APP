import assert from "node:assert/strict";
import test from "node:test";

import * as admin from "../lib/admin/index.ts";

const vehicleInput = Object.freeze({
  idempotencyKey: "vehicle:create:contract-1",
  slug: "ford-focus-2020",
  make: "Ford",
  model: "Focus",
  trim: "SE Plus",
  year: 2020,
  mileageKm: 72_000,
  priceCents: 24_000_000_00,
  currency: "ARS",
  bodyType: "hatchback",
  fuelType: "nafta",
  transmission: "manual",
  color: "blanco",
  source: "manual",
});

function creationDependencies(captured) {
  let sequence = 0;
  return {
    authorize: async () => ({
      userId: "operator-1",
      email: "operator@example.com",
      displayName: "Operador",
    }),
    clock: () => new Date("2026-08-16T15:00:00.000Z"),
    idGenerator: () => `server-generated-${++sequence}`,
    repositories: {
      stock: {
        async create(input, key, context) {
          captured.push({ input, key, context });
          return {
            ok: true,
            record: {
              ...input,
              version: 1,
              publishedAt: null,
              createdAt: "2026-08-16T15:00:00.000Z",
              updatedAt: "2026-08-16T15:00:00.000Z",
            },
          };
        },
      },
    },
  };
}

test("API pública cubre operaciones sin exponer borrado físico", () => {
  const expectedFunctions = [
    "getAdminOverview",
    "listAdminStock",
    "getAdminVehicle",
    "createAdminVehicle",
    "editAdminVehicle",
    "transitionAdminVehicle",
    "listAdminLeads",
    "getAdminLead",
    "transitionAdminLead",
    "listAdminAppraisals",
    "getAdminAppraisal",
    "reviewAdminAppraisal",
    "listAdminConsignments",
    "getAdminConsignment",
    "reviewAdminConsignment",
    "listFinanceVersions",
    "getFinanceVersion",
    "createFinanceVersion",
    "transitionFinanceVersion",
    "listAdminPromotions",
    "getAdminPromotion",
    "createAdminPromotion",
    "scheduleAdminPromotion",
    "activateAdminPromotion",
    "pauseAdminPromotion",
    "expireAdminPromotion",
    "archiveAdminPromotion",
  ];
  for (const name of expectedFunctions) assert.equal(typeof admin[name], "function", name);
  assert.deepEqual(
    Object.keys(admin).filter((name) => /delete|remove/i.test(name)),
    [],
  );
});

test("hash idempotente representa el comando y no los IDs generados", async () => {
  const first = [];
  const second = [];
  await admin.createAdminVehicle(creationDependencies(first), vehicleInput);
  await admin.createAdminVehicle(creationDependencies(second), vehicleInput);

  assert.match(first[0].context.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(first[0].context.requestHash, second[0].context.requestHash);
  assert.equal(first[0].key, vehicleInput.idempotencyKey);
  assert.equal(first[0].context.audit.expectedVersion, null);
  assert.equal(first[0].context.audit.entityType, "VEHICLE");
});

test("una clave reutilizada con otro comando devuelve un error estable en español", async () => {
  const deps = creationDependencies([]);
  deps.repositories.stock.create = async () => ({ ok: false, reason: "idempotency_conflict" });

  await assert.rejects(
    () => admin.createAdminVehicle(deps, vehicleInput),
    (error) => {
      assert.ok(error instanceof admin.AdminError);
      assert.equal(error.code, "ADMIN_IDEMPOTENCY_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.toJSON(), {
        code: "ADMIN_IDEMPOTENCY_CONFLICT",
        message: "La clave de idempotencia ya fue usada con otros datos.",
      });
      return true;
    },
  );
});
