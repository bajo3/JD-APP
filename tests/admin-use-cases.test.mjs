import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminError,
  activateAdminPromotion,
  createFinanceVersion,
  getAdminOverview,
  reviewAdminAppraisal,
  transitionAdminLead,
  transitionAdminVehicle,
  transitionFinanceVersion,
} from "../lib/admin/index.ts";

const NOW = new Date("2026-08-16T15:00:00.000Z");
const actor = Object.freeze({
  userId: "operator-1",
  email: "operator@example.com",
  displayName: "Operador",
});

function vehicle(overrides = {}) {
  return {
    id: "vehicle-1",
    slug: "toyota-corolla-2022",
    externalCode: null,
    make: "Toyota",
    model: "Corolla",
    trim: "XEI CVT",
    year: 2022,
    mileageKm: 45_000,
    priceCents: 31_500_000_00,
    currency: "ARS",
    priceValidUntil: "2026-08-20T00:00:00.000Z",
    bodyType: "sedan",
    fuelType: "nafta",
    transmission: "automatica",
    color: "gris",
    status: "DRAFT",
    source: "manual",
    internalNotes: null,
    version: 1,
    publishedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function lead(overrides = {}) {
  return {
    id: "lead-1",
    name: "Cliente",
    phoneMasked: "******1234",
    status: "NEW",
    assignedTo: null,
    lostReason: null,
    source: "web",
    vehicleId: null,
    simulationCode: null,
    version: 1,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function appraisal(overrides = {}) {
  return {
    id: "appraisal-1",
    leadId: "lead-1",
    vehicleDescription: "Volkswagen Gol 2018",
    status: "IN_REVIEW",
    lowCents: null,
    baseCents: null,
    highCents: null,
    currency: "ARS",
    certaintyLevel: "T0",
    validUntil: null,
    notes: null,
    version: 2,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function finance(overrides = {}) {
  return {
    id: "finance-1",
    version: "JDA-2026-08-A",
    lockVersion: 1,
    name: "Plan pesos",
    provider: "Proveedor",
    currency: "ARS",
    status: "DRAFT",
    pricingKind: "french",
    monthlyRateBps: 250,
    installmentCoefficientPpm: null,
    maxFinanceRatioBps: 8_000,
    minimumDownPaymentRatioBps: 2_000,
    allowedVehicleTypes: ["used"],
    maxVehicleAgeYears: 15,
    requiresPromotionId: null,
    comfortablePaymentMarginBps: 1_000,
    validFrom: "2026-08-16T00:00:00.000Z",
    validUntil: "2026-09-16T00:00:00.000Z",
    disclaimer: "Sujeto a evaluación crediticia.",
    tiers: [
      {
        id: "tier-1",
        termMonths: 24,
        minAmountCents: 1_000_000_00,
        maxAmountCents: 20_000_000_00,
        installmentCoefficientPpm: null,
        sortOrder: 0,
      },
    ],
    publishedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function promotion(overrides = {}) {
  return {
    id: "promotion-1",
    slug: "oferta-corolla",
    publicCode: "OJD-001",
    title: "Oferta JD",
    description: "Beneficio por tiempo limitado.",
    type: "vehicle_discount",
    status: "SCHEDULED",
    vehicleIds: ["vehicle-1"],
    startsAt: "2026-08-16T14:00:00.000Z",
    endsAt: "2026-08-17T14:00:00.000Z",
    discountCents: 1_000_000_00,
    tradeInBonusCents: 0,
    financePlanVersionId: null,
    stackable: false,
    normalConditionsSnapshot: { priceCents: 31_500_000_00, currency: "ARS" },
    version: 2,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo: false,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  let generated = 0;
  const repositories = {
    overview: {
      async get() {
        return {
          stock: { DRAFT: 1, AVAILABLE: 1, RESERVED: 0, SOLD: 0, PAUSED: 0, ARCHIVED: 0 },
          leads: { NEW: 1, CONTACTED: 0, QUALIFIED: 0, WON: 0, LOST: 0 },
          appraisals: { SUBMITTED: 0, IN_REVIEW: 1, ESTIMATED: 0, APPROVED: 0, REJECTED: 0, EXPIRED: 0 },
          finance: { DRAFT: 1, PUBLISHED: 0, RETIRED: 0 },
          promotions: { DRAFT: 0, SCHEDULED: 1, ACTIVE: 0, PAUSED: 0, EXPIRED: 0, ARCHIVED: 0 },
          generatedAt: NOW.toISOString(),
          isDemo: false,
        };
      },
    },
    stock: {
      async list() { return []; },
      async findById() { return vehicle(); },
      async create(input) { return { ok: true, record: { ...vehicle(), ...input } }; },
      async update(input) {
        return { ok: true, record: vehicle({ ...input.patch, version: input.expectedVersion + 1 }) };
      },
      async archive(input) {
        return { ok: true, record: vehicle({ status: "ARCHIVED", version: input.expectedVersion + 1 }) };
      },
    },
    leads: {
      async list() { return []; },
      async findById() { return lead(); },
      async transition(input) {
        return { ok: true, record: lead({ status: input.nextStatus, version: input.expectedVersion + 1 }) };
      },
    },
    appraisals: {
      async list() { return []; },
      async findById() { return appraisal(); },
      async review(input) {
        return { ok: true, record: appraisal({ ...input, version: input.expectedVersion + 1 }) };
      },
    },
    finance: {
      async listVersions() { return []; },
      async findById() { return finance(); },
      async createVersion(input) { return { ok: true, record: { ...finance(), ...input } }; },
      async setStatus(input) {
        return { ok: true, record: finance({ status: input.nextStatus, lockVersion: input.expectedVersion + 1 }) };
      },
    },
    promotions: {
      async list() { return []; },
      async findById() { return promotion(); },
      async create(input) { return { ok: true, record: { ...promotion(), ...input } }; },
      async schedule(input) {
        return { ok: true, record: promotion({ ...input, status: "SCHEDULED", version: input.expectedVersion + 1 }) };
      },
      async setStatus(input) {
        return { ok: true, record: promotion({ status: input.nextStatus, version: input.expectedVersion + 1 }) };
      },
    },
  };
  return {
    authorize: async () => actor,
    clock: () => new Date(NOW),
    idGenerator: () => `generated-${++generated}`,
    repositories,
    ...overrides,
  };
}

test("cada lectura vuelve a autorizar antes de consultar el repositorio", async () => {
  let consulted = false;
  const deps = dependencies({
    authorize: async () => {
      throw new Error("DENIED");
    },
  });
  deps.repositories.overview.get = async () => {
    consulted = true;
    throw new Error("UNEXPECTED");
  };

  await assert.rejects(() => getAdminOverview(deps), /DENIED/);
  assert.equal(consulted, false);
});

test("publicar stock valida completitud y entrega actor/auditoría al CAS", async () => {
  const deps = dependencies();
  let mutation;
  deps.repositories.stock.update = async (input) => {
    mutation = input;
    return { ok: true, record: vehicle({ status: "AVAILABLE", version: 2 }) };
  };

  const result = await transitionAdminVehicle(deps, {
    id: "vehicle-1",
    expectedVersion: 1,
    nextStatus: "AVAILABLE",
  });

  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(mutation.actor, actor);
  assert.equal(mutation.audit.action, "VEHICLE_PUBLISHED");
  assert.equal(mutation.audit.expectedVersion, 1);
  assert.equal(mutation.patch.publishedAt, NOW.toISOString());
});

test("pipeline de leads rechaza saltos y exige motivo de pérdida", async () => {
  const invalidDeps = dependencies();
  await assert.rejects(
    () => transitionAdminLead(invalidDeps, { id: "lead-1", expectedVersion: 1, nextStatus: "WON" }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_TRANSITION",
  );

  const qualifiedDeps = dependencies();
  qualifiedDeps.repositories.leads.findById = async () => lead({ status: "QUALIFIED", version: 3 });
  await assert.rejects(
    () => transitionAdminLead(qualifiedDeps, { id: "lead-1", expectedVersion: 3, nextStatus: "LOST" }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_INPUT",
  );
});

test("revisión de tasación usa T0/T1, rango ordenado y vigencia futura", async () => {
  const deps = dependencies();
  let mutation;
  deps.repositories.appraisals.review = async (input) => {
    mutation = input;
    return {
      ok: true,
      record: appraisal({
        status: "ESTIMATED",
        lowCents: input.lowCents,
        baseCents: input.baseCents,
        highCents: input.highCents,
        certaintyLevel: input.certaintyLevel,
        validUntil: input.validUntil,
        version: 3,
      }),
    };
  };

  const result = await reviewAdminAppraisal(deps, {
    id: "appraisal-1",
    expectedVersion: 2,
    nextStatus: "ESTIMATED",
    lowCents: 8_000_000_00,
    baseCents: 9_000_000_00,
    highCents: 10_000_000_00,
    currency: "ARS",
    certaintyLevel: "T1",
    validUntil: "2026-08-20T00:00:00.000Z",
  });

  assert.equal(result.certaintyLevel, "T1");
  assert.equal(mutation.audit.action, "APPRAISAL_STATUS_CHANGED");
  await assert.rejects(
    () => reviewAdminAppraisal(deps, {
      id: "appraisal-1",
      expectedVersion: 2,
      nextStatus: "ESTIMATED",
      lowCents: 10,
      baseCents: 9,
      highCents: 11,
      currency: "ARS",
      certaintyLevel: "T0",
      validUntil: "2026-08-20T00:00:00.000Z",
    }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_INPUT",
  );
});

test("tarifarios conservan el modelo real del motor y publicados son inmutables", async () => {
  const deps = dependencies();
  let created;
  deps.repositories.finance.createVersion = async (input, key, context) => {
    created = { input, key, context };
    return { ok: true, record: { ...finance(), ...input } };
  };
  await createFinanceVersion(deps, {
    idempotencyKey: "finance:create:001",
    version: "JDA-2026-08-B",
    name: "Plan coeficiente",
    provider: "Proveedor",
    currency: "ARS",
    pricingKind: "coefficient",
    installmentCoefficientPpm: 62_500,
    maxFinanceRatioBps: 8_000,
    minimumDownPaymentRatioBps: 2_000,
    allowedVehicleTypes: ["used"],
    maxVehicleAgeYears: 15,
    comfortablePaymentMarginBps: 1_000,
    validFrom: "2026-08-17T00:00:00.000Z",
    validUntil: "2026-09-17T00:00:00.000Z",
    disclaimer: "Sujeto a aprobación.",
    tiers: [{ termMonths: 24, minAmountCents: 100_00, maxAmountCents: 1_000_000_00, installmentCoefficientPpm: null, sortOrder: 0 }],
  });
  assert.equal(created.input.pricingKind, "coefficient");
  assert.equal(created.input.installmentCoefficientPpm, 62_500);
  assert.equal(created.context.audit.action, "FINANCE_VERSION_CREATED");

  const publishedDeps = dependencies();
  publishedDeps.repositories.finance.findById = async () => finance({ status: "PUBLISHED", lockVersion: 2 });
  await assert.rejects(
    () => transitionFinanceVersion(publishedDeps, { id: "finance-1", expectedVersion: 2, nextStatus: "PUBLISHED" }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_TRANSITION",
  );
});

test("activar Oferta JD exige ventana, snapshot y unidades disponibles", async () => {
  const deps = dependencies();
  let mutation;
  deps.repositories.stock.findById = async () => vehicle({ status: "AVAILABLE" });
  deps.repositories.promotions.setStatus = async (input) => {
    mutation = input;
    return { ok: true, record: promotion({ status: "ACTIVE", version: 3 }) };
  };

  const result = await activateAdminPromotion(deps, { id: "promotion-1", expectedVersion: 2 });
  assert.equal(result.status, "ACTIVE");
  assert.equal(mutation.audit.action, "PROMOTION_ACTIVATED");

  const unavailableDeps = dependencies();
  unavailableDeps.repositories.stock.findById = async () => vehicle({ status: "RESERVED" });
  await assert.rejects(
    () => activateAdminPromotion(unavailableDeps, { id: "promotion-1", expectedVersion: 2 }),
    (error) => error instanceof AdminError && error.code === "ADMIN_INVALID_INPUT",
  );
});

test("conflicto CAS se traduce a error estable y DTOs nunca exponen BigInt", async () => {
  const conflictDeps = dependencies();
  conflictDeps.repositories.stock.update = async () => ({ ok: false, reason: "conflict", currentVersion: 7 });
  await assert.rejects(
    () => transitionAdminVehicle(conflictDeps, { id: "vehicle-1", expectedVersion: 1, nextStatus: "AVAILABLE" }),
    (error) =>
      error instanceof AdminError &&
      error.code === "ADMIN_VERSION_CONFLICT" &&
      error.details.currentVersion === 7,
  );

  const bigintDeps = dependencies();
  bigintDeps.repositories.overview.get = async () => ({ unsafe: 1n });
  await assert.rejects(
    () => getAdminOverview(bigintDeps),
    (error) => error instanceof AdminError && error.code === "ADMIN_CONFIGURATION_ERROR",
  );
});
