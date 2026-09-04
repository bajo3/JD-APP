import assert from "node:assert/strict";
import test from "node:test";

import {
  appraisalDto,
  businessProfileDto,
  promotionDto,
  simulationDto,
  vehicleDto,
} from "../lib/server/dto.ts";
import {
  isConfirmedWhatsappNumber,
  isPromotionCurrent,
} from "../lib/server/channel-policy.ts";
import { RemoteD1Error } from "../db/d1-remote.ts";
import { canUseDevelopmentFixtures } from "../lib/server/runtime-policy.ts";

const clock = new Date("2026-08-16T15:00:00.000Z");

test("vehicle DTO exposes public fields and derives freshness from server time", () => {
  const base = {
    id: "vehicle-1",
    slug: "fiat-cronos-2023",
    externalCode: "PRIVATE-ERP-1",
    make: "Fiat",
    model: "Cronos",
    trim: "Drive",
    year: 2023,
    mileageKm: 20000,
    priceCents: 2500000000,
    currency: "ARS",
    priceValidUntil: null,
    bodyType: "Sedán",
    fuelType: "Nafta",
    transmission: "Manual",
    color: "Blanco",
    status: "AVAILABLE",
    source: "private-erp",
    lastSyncedAt: "2026-08-16T14:30:00.000Z",
    publishedAt: "2026-08-16T14:00:00.000Z",
    internalNotes: "No exponer",
    version: 4,
    createdAt: "2026-08-16T14:00:00.000Z",
    updatedAt: "2026-08-16T14:30:00.000Z",
    media: [
      {
        id: "media-1",
        vehicleId: "vehicle-1",
        r2Key: "internal/storage/key",
        publicUrl: "/media/vehicle-1.jpg",
        contentType: "image/jpeg",
        altText: "Fiat Cronos blanco",
        sortOrder: 0,
        width: 1200,
        height: 800,
        createdAt: "2026-08-16T14:00:00.000Z",
      },
    ],
  };
  const fresh = vehicleDto(base, 60, clock);
  assert.equal(fresh.availability, "AVAILABLE_TODAY");
  assert.equal("internalNotes" in fresh, false);
  assert.equal("externalCode" in fresh, false);
  assert.equal("r2Key" in fresh.media[0], false);

  const stale = vehicleDto({ ...base, lastSyncedAt: "2026-08-16T13:00:00.000Z" }, 60, clock);
  assert.equal(stale.availability, "CHECK_AVAILABILITY");
});

test("business, appraisal and simulation DTOs preserve stable public contracts", () => {
  const profile = businessProfileDto({
    id: "business-jda",
    name: "Jesús Díaz Automotores",
    city: "Tandil",
    address: "Piedrabuena esq. Rauch",
    phoneNational: "2494587046",
    whatsappE164: null,
    timezone: "America/Argentina/Buenos_Aires",
    currency: "ARS",
    locale: "es-AR",
    mapUrl: null,
    hoursJson: "not-json",
    socialLinksJson: "{}",
    stockFreshnessMinutes: 1440,
    version: 1,
    createdAt: clock.toISOString(),
    updatedAt: clock.toISOString(),
  });
  assert.equal(profile.hours, null);
  assert.deepEqual(profile.socialLinks, {});
  assert.equal("version" in profile, false);

  const appraisal = appraisalDto({
    id: "appraisal-1",
    publicCode: "TAS-001",
    idempotencyKey: "private-key",
    leadId: "lead-1",
    make: "Renault",
    model: "Sandero",
    trim: null,
    year: 2019,
    mileageKm: 70000,
    declaredCondition: "GOOD",
    documentationStatus: null,
    hasLien: false,
    repairNotes: null,
    status: "SUBMITTED",
    certaintyLevel: "T0",
    lowCents: null,
    baseCents: null,
    highCents: null,
    currency: "ARS",
    ruleSetId: null,
    reviewedBy: null,
    reviewNotes: null,
    validUntil: null,
    version: 1,
    createdAt: clock.toISOString(),
    updatedAt: clock.toISOString(),
  });
  assert.equal(appraisal.range, null);
  assert.equal("idempotencyKey" in appraisal, false);

  const simulation = simulationDto({
    id: "simulation-1",
    publicCode: "JD-001",
    idempotencyKey: "private-key",
    leadId: "lead-1",
    vehicleId: "vehicle-1",
    appraisalId: null,
    promotionId: null,
    status: "ACTIVE",
    classification: "REQUIRES_EVALUATION",
    certaintyLevel: "T0",
    vehiclePriceCents: 100,
    effectivePriceCents: 100,
    appraisalAppliedCents: 0,
    tradeInBonusCents: 0,
    cashCents: 10,
    financePrincipalCents: 90,
    termMonths: null,
    installmentCents: null,
    totalCostCents: null,
    currency: "ARS",
    engineVersion: "engine-1",
    ruleVersion: "rules-1",
    financePlanVersion: null,
    inputSnapshotJson: '{"cashCents":10}',
    resultSnapshotJson: '{"reason":"review"}',
    disclaimerSnapshot: "Preliminar.",
    expiresAt: "2026-08-17T15:00:00.000Z",
    createdAt: clock.toISOString(),
  });
  assert.deepEqual(simulation.input, { cashCents: 10 });
  assert.deepEqual(simulation.result, { reason: "review" });
  assert.equal("idempotencyKey" in simulation, false);
});

test("fixtures are allowed for a missing binding in development and forbidden in production", () => {
  const missing = new Error("Cloudflare D1 binding `DB` is unavailable.");
  const missingRemoteConfiguration = new RemoteD1Error("D1_REMOTE_CONFIG_INVALID");
  assert.equal(canUseDevelopmentFixtures(missing, "development"), true);
  assert.equal(canUseDevelopmentFixtures(missing, "test"), true);
  assert.equal(canUseDevelopmentFixtures(missing, "production"), false);
  assert.equal(canUseDevelopmentFixtures(missing, undefined), false);
  assert.equal(canUseDevelopmentFixtures(missingRemoteConfiguration, "development"), true);
  assert.equal(canUseDevelopmentFixtures(missingRemoteConfiguration, "production"), false);
  assert.equal(canUseDevelopmentFixtures(new Error("database timeout"), "development"), false);
});

test("WhatsApp remains unavailable until an international number is confirmed", () => {
  assert.equal(isConfirmedWhatsappNumber(null), false);
  assert.equal(isConfirmedWhatsappNumber("2494587046"), false);
  assert.equal(isConfirmedWhatsappNumber("+5492494587046"), true);
});

test("expired offers are excluded with an exclusive server-time end", () => {
  const promotion = {
    status: "ACTIVE",
    startsAt: "2026-08-16T14:00:00.000Z",
    endsAt: "2026-08-16T16:00:00.000Z",
  };
  assert.equal(isPromotionCurrent(promotion, clock), true);
  assert.equal(isPromotionCurrent(promotion, new Date(promotion.endsAt)), false);
  assert.equal(isPromotionCurrent({ ...promotion, status: "PAUSED" }, clock), false);
});

test("promotion DTO uses server time and omits internal condition snapshots", () => {
  const dto = promotionDto(
    {
      id: "promotion-1",
      slug: "oferta-del-dia",
      publicCode: "JD-OFFER",
      title: "Oferta",
      description: "Vigente hoy",
      type: "PRICE_DISCOUNT",
      status: "ACTIVE",
      discountCents: 10000,
      tradeInBonusCents: 0,
      financePlanVersionId: null,
      stackable: false,
      normalConditionsSnapshotJson: '{"privateMargin":1}',
      startsAt: "2026-08-16T14:00:00.000Z",
      endsAt: "2026-08-16T16:00:00.000Z",
      publishedAt: "2026-08-16T14:00:00.000Z",
      version: 2,
      createdAt: "2026-08-16T13:00:00.000Z",
      updatedAt: "2026-08-16T14:00:00.000Z",
      vehicleIds: ["vehicle-1"],
    },
    clock,
  );
  assert.equal(dto.serverNow, clock.toISOString());
  assert.equal("normalConditionsSnapshotJson" in dto, false);
  assert.equal("version" in dto, false);
});
