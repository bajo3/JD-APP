import type {
  AppraisalRow,
  BusinessProfileRow,
  SimulationRow,
} from "@/db/schema";
import type { CurrentPromotion, StockVehicle } from "@/lib/data/repositories";

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function vehicleDto(
  vehicle: StockVehicle,
  stockFreshnessMinutes: number,
  now = new Date(),
) {
  const lastSync = vehicle.lastSyncedAt ? Date.parse(vehicle.lastSyncedAt) : Number.NaN;
  const fresh =
    Number.isFinite(lastSync) && now.getTime() - lastSync <= stockFreshnessMinutes * 60_000;
  return {
    id: vehicle.id,
    slug: vehicle.slug,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    year: vehicle.year,
    mileageKm: vehicle.mileageKm,
    price: {
      cents: vehicle.priceCents,
      currency: vehicle.currency,
      validUntil: vehicle.priceValidUntil,
    },
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    color: vehicle.color,
    demo: vehicle.source === "fixture" || vehicle.source === "DEMO_SEED",
    availability: fresh ? ("AVAILABLE_TODAY" as const) : ("CHECK_AVAILABILITY" as const),
    lastSyncedAt: vehicle.lastSyncedAt,
    media: vehicle.media.map((media) => ({
      id: media.id,
      url: media.publicUrl,
      alt: media.altText,
      contentType: media.contentType,
      width: media.width,
      height: media.height,
    })),
    updatedAt: vehicle.updatedAt,
  };
}

export function businessProfileDto(profile: BusinessProfileRow) {
  return {
    name: profile.name,
    city: profile.city,
    address: profile.address,
    phoneNational: profile.phoneNational,
    whatsappE164: profile.whatsappE164,
    timezone: profile.timezone,
    currency: profile.currency,
    locale: profile.locale,
    mapUrl: profile.mapUrl,
    hours: parseJson(profile.hoursJson),
    socialLinks: parseJson(profile.socialLinksJson),
    stockFreshnessMinutes: profile.stockFreshnessMinutes,
    updatedAt: profile.updatedAt,
  };
}

export function promotionDto(promotion: CurrentPromotion, now = new Date()) {
  const normalConditions = parseJson(promotion.normalConditionsSnapshotJson);
  const demo =
    Boolean(
      normalConditions &&
        typeof normalConditions === "object" &&
        "demo" in normalConditions &&
        normalConditions.demo === true,
    ) ||
    promotion.title.startsWith("DEMO");
  return {
    id: promotion.id,
    slug: promotion.slug,
    code: promotion.publicCode,
    title: promotion.title,
    description: promotion.description,
    type: promotion.type,
    discountCents: promotion.discountCents,
    tradeInBonusCents: promotion.tradeInBonusCents,
    currency: "ARS",
    stackable: promotion.stackable,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    serverNow: now.toISOString(),
    vehicleIds: promotion.vehicleIds,
    demo,
  };
}

export function appraisalDto(appraisal: AppraisalRow) {
  return {
    id: appraisal.id,
    code: appraisal.publicCode,
    vehicle: {
      make: appraisal.make,
      model: appraisal.model,
      trim: appraisal.trim,
      year: appraisal.year,
      mileageKm: appraisal.mileageKm,
    },
    status: appraisal.status,
    certaintyLevel: appraisal.certaintyLevel,
    range:
      appraisal.lowCents === null ||
      appraisal.baseCents === null ||
      appraisal.highCents === null
        ? null
        : {
            lowCents: appraisal.lowCents,
            baseCents: appraisal.baseCents,
            highCents: appraisal.highCents,
            currency: appraisal.currency,
          },
    validUntil: appraisal.validUntil,
    createdAt: appraisal.createdAt,
  };
}

export function simulationDto(simulation: SimulationRow) {
  return {
    id: simulation.id,
    code: simulation.publicCode,
    status: simulation.status,
    classification: simulation.classification,
    certaintyLevel: simulation.certaintyLevel,
    vehicleId: simulation.vehicleId,
    appraisalId: simulation.appraisalId,
    promotionId: simulation.promotionId,
    amounts: {
      vehiclePriceCents: simulation.vehiclePriceCents,
      effectivePriceCents: simulation.effectivePriceCents,
      appraisalAppliedCents: simulation.appraisalAppliedCents,
      tradeInBonusCents: simulation.tradeInBonusCents,
      cashCents: simulation.cashCents,
      financePrincipalCents: simulation.financePrincipalCents,
      installmentCents: simulation.installmentCents,
      totalCostCents: simulation.totalCostCents,
      currency: simulation.currency,
    },
    termMonths: simulation.termMonths,
    engineVersion: simulation.engineVersion,
    ruleVersion: simulation.ruleVersion,
    input: parseJson(simulation.inputSnapshotJson),
    result: parseJson(simulation.resultSnapshotJson),
    disclaimer: simulation.disclaimerSnapshot,
    createdAt: simulation.createdAt,
    expiresAt: simulation.expiresAt,
  };
}
