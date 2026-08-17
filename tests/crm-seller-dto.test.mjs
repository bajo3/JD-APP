import assert from "node:assert/strict";
import test from "node:test";

import {
  CrmContractError,
  buildSellerLeadDetailDto,
} from "../lib/crm/index.mjs";

const lead = Object.freeze({
  id: "lead-1",
  name: "Martín González",
  phoneNormalized: "+5492494587046",
  source: "AFFORDABILITY_WEB",
  status: "NEW",
  createdAt: "2026-08-17T10:00:00.000Z",
  updatedAt: "2026-08-17T10:02:00.000Z",
});
const vehicle = Object.freeze({
  id: "vehicle-1",
  slug: "toyota-corolla-xei-2022",
  make: "Toyota",
  model: "Corolla",
  trim: "XEI CVT",
  year: 2022,
});
const simulation = Object.freeze({
  id: "simulation-1",
  publicCode: "JD-ABC123",
  leadId: "lead-1",
  vehicleId: "vehicle-1",
  promotionId: "promotion-1",
  status: "ACTIVE",
  classification: "REACHABLE_ESTIMATED",
  certaintyLevel: "T0",
  vehiclePriceCents: 28_000_000_00n,
  effectivePriceCents: 27_700_000_00n,
  appraisalAppliedCents: 15_000_000_00n,
  tradeInBonusCents: 300_000_00n,
  cashCents: 4_000_000_00n,
  financePrincipalCents: 8_400_000_00n,
  termMonths: 18n,
  installmentCents: 500_000_00n,
  totalCostCents: 9_000_000_00n,
  currency: "ARS",
  disclaimerSnapshot: "Simulación preliminar sujeta a verificación.",
  resultSnapshotJson: JSON.stringify({
    evaluation: { breakdown: { effectivePrice: { minorUnits: 1 } } },
  }),
  createdAt: "2026-08-17T10:01:00.000Z",
  expiresAt: "2026-08-17T11:01:00.000Z",
});

function build(overrides = {}) {
  return buildSellerLeadDetailDto({
    lead,
    simulation,
    vehicle,
    events: [],
    now: "2026-08-17T10:30:00.000Z",
    ...overrides,
  });
}

test("el DTO del vendedor copia el snapshot persistido sin recalcular importes", () => {
  const dto = build();
  assert.equal(dto.operation.vehicle.label, "Toyota Corolla XEI CVT 2022");
  assert.deepEqual(dto.operation.amounts, {
    currency: "ARS",
    listedPriceCents: 2_800_000_000,
    effectivePriceCents: 2_770_000_000,
    appraisalAppliedCents: 1_500_000_000,
    tradeInBonusCents: 30_000_000,
    cashCents: 400_000_000,
    financePrincipalCents: 840_000_000,
    installmentCents: 50_000_000,
    totalCostCents: 900_000_000,
  });
  assert.notEqual(dto.operation.amounts.effectivePriceCents, 1);
  assert.equal(dto.operation.termMonths, 18);
  assert.equal(dto.operation.validity, "ACTIVE");
  assert.equal(dto.operation.disclaimer, simulation.disclaimerSnapshot);
  assert.equal(JSON.stringify(dto).includes("BigInt"), false);
  assert.doesNotThrow(() => JSON.stringify(dto));
});

test("una simulación vencida sigue visible y el final de vigencia es exclusivo", () => {
  const expired = build({ now: simulation.expiresAt });
  assert.equal(expired.operation.validity, "EXPIRED");
  assert.equal(expired.operation.simulationCode, simulation.publicCode);
  assert.equal(expired.operation.amounts.financePrincipalCents, 840_000_000);
});

test("un lead general conserva detalle y eventos con operation null", () => {
  const dto = build({
    simulation: null,
    vehicle: null,
    events: [{
      id: "event-general",
      type: "LEAD_CREATED",
      actorType: "CUSTOMER",
      occurredAt: "2026-08-17T10:02:00.000Z",
      metadata: { source: "CONTACTO_WEB" },
    }],
  });
  assert.equal(dto.operation, null);
  assert.equal(dto.name, lead.name);
  assert.equal(dto.events[0].metadata.source, "CONTACTO_WEB");
  assert.ok(Object.isFrozen(dto));

  assert.throws(
    () => build({ simulation: null }),
    (error) =>
      error instanceof CrmContractError &&
      error.code === "CRM_INVALID_SNAPSHOT" &&
      error.field === "simulation",
  );
});

test("el DTO completo, montos, vehículo, eventos y metadata son inmutables", () => {
  const dto = build({
    events: [
      {
        id: "event-old",
        type: "LEAD_CREATED",
        actorType: "CUSTOMER",
        occurredAt: "2026-08-17T10:02:00.000Z",
        metadata: { status: 1n, requestHash: "secret", idempotencyKey: "private" },
      },
      {
        id: "event-new",
        type: "WHATSAPP_HANDOFF_CREATED",
        actorType: "CUSTOMER",
        occurredAt: "2026-08-17T10:03:00.000Z",
        metadataJson: JSON.stringify({ handoffCode: "JD-HAND1", mode: "CLICK_TO_CHAT" }),
      },
    ],
  });
  assert.deepEqual(dto.events.map((event) => event.id), ["event-new", "event-old"]);
  assert.equal(dto.events[1].metadata.status, 1);
  assert.equal("requestHash" in dto.events[1].metadata, false);
  assert.equal("idempotencyKey" in dto.events[1].metadata, false);
  for (const value of [dto, dto.operation, dto.operation.amounts, dto.operation.vehicle, dto.events, dto.events[0], dto.events[0].metadata]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => {
    dto.operation.amounts.cashCents = 0;
  }, TypeError);
});

test("BigInt monetario fuera del rango seguro falla en vez de cambiar el contrato", () => {
  assert.throws(
    () => build({
      simulation: {
        ...simulation,
        effectivePriceCents: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      },
    }),
    (error) =>
      error instanceof CrmContractError &&
      error.code === "CRM_INVALID_SNAPSHOT" &&
      error.field === "simulation.effectivePriceCents",
  );
});

test("metadata JSON inválida o circular se rechaza con error estable", () => {
  assert.throws(
    () => build({
      events: [{
        id: "event-1",
        type: "BROKEN",
        occurredAt: "2026-08-17T10:03:00.000Z",
        actorType: "SYSTEM",
        metadataJson: "{",
      }],
    }),
    (error) => error instanceof CrmContractError && error.code === "CRM_INVALID_SNAPSHOT",
  );

  const circular = {};
  circular.self = circular;
  assert.throws(
    () => build({
      events: [{
        id: "event-2",
        type: "BROKEN",
        occurredAt: "2026-08-17T10:03:00.000Z",
        actorType: "SYSTEM",
        metadata: { status: circular },
      }],
    }),
    (error) => error instanceof CrmContractError && error.code === "CRM_INVALID_SNAPSHOT",
  );
});
