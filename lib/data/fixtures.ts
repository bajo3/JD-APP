import type { Database } from "@/db";
import {
  appraisals,
  businessProfiles,
  financePlanTiers,
  financePlanVersions,
  leads,
  promotionVehicles,
  promotions,
  simulations,
  vehiclePriceHistory,
  vehicles,
} from "@/db/schema";

export const businessProfileFixture: typeof businessProfiles.$inferInsert = {
  id: "business-jda",
  name: "Jesús Díaz Automotores",
  city: "Tandil",
  address: "Piedrabuena esq. Rauch",
  phoneNational: "2494587046",
  whatsappE164: "+5492494587046",
  timezone: "America/Argentina/Buenos_Aires",
  currency: "ARS",
  locale: "es-AR",
  stockFreshnessMinutes: 1440,
};

export const stockFixtures: Array<typeof vehicles.$inferInsert> = [
  {
    id: "veh-tcross-2022",
    slug: "volkswagen-t-cross-comfortline-2022",
    externalCode: "DEMO-001",
    make: "Volkswagen",
    model: "T-Cross",
    trim: "Comfortline",
    year: 2022,
    mileageKm: 46500,
    priceCents: 32_800_000_00,
    bodyType: "SUV",
    fuelType: "Nafta",
    transmission: "Automática",
    color: "Gris",
    status: "AVAILABLE",
    source: "fixture",
  },
  {
    id: "veh-cronos-2023",
    slug: "fiat-cronos-drive-2023",
    externalCode: "DEMO-002",
    make: "Fiat",
    model: "Cronos",
    trim: "Drive 1.3",
    year: 2023,
    mileageKm: 28100,
    priceCents: 24_900_000_00,
    bodyType: "Sedán",
    fuelType: "Nafta",
    transmission: "Manual",
    color: "Blanco",
    status: "AVAILABLE",
    source: "fixture",
  },
  {
    id: "veh-tracker-2021",
    slug: "chevrolet-tracker-ltz-2021",
    externalCode: "DEMO-003",
    make: "Chevrolet",
    model: "Tracker",
    trim: "LTZ",
    year: 2021,
    mileageKm: 52900,
    priceCents: 29_700_000_00,
    bodyType: "SUV",
    fuelType: "Nafta",
    transmission: "Automática",
    color: "Azul",
    status: "AVAILABLE",
    source: "fixture",
  },
  {
    id: "veh-ranger-2020",
    slug: "ford-ranger-xls-2020",
    externalCode: "DEMO-004",
    make: "Ford",
    model: "Ranger",
    trim: "XLS 3.2 4x2",
    year: 2020,
    mileageKm: 88600,
    priceCents: 37_500_000_00,
    bodyType: "Pick-up",
    fuelType: "Diésel",
    transmission: "Manual",
    color: "Plata",
    status: "AVAILABLE",
    source: "fixture",
  },
];

export const leadFixture: typeof leads.$inferInsert = {
  id: "lead-demo-001",
  idempotencyKey: "fixture-lead-001",
  name: "Cliente de demostración",
  phoneNormalized: "+5400000000000",
  source: "fixture",
  status: "NEW",
  score: 35,
};

export function createAppraisalFixture(now = new Date()): typeof appraisals.$inferInsert {
  return {
    id: "appraisal-demo-001",
    publicCode: "TAS-DEMO1",
    idempotencyKey: "fixture-appraisal-001",
    leadId: leadFixture.id,
    make: "Renault",
    model: "Sandero",
    trim: "Expression",
    year: 2018,
    mileageKm: 94000,
    declaredCondition: "GOOD",
    documentationStatus: "DECLARED_COMPLETE",
    status: "PRELIMINARY",
    certaintyLevel: "T1",
    lowCents: 10_800_000_00,
    baseCents: 11_500_000_00,
    highCents: 12_100_000_00,
    validUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function createPromotionFixture(now = new Date()): typeof promotions.$inferInsert {
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  return {
    id: "promo-demo-dia",
    slug: "oferta-demo-del-dia",
    publicCode: "JD-DEMO",
    title: "DEMO — Oferta JD de previsualización",
    description: "Condición ilustrativa para validar la experiencia; no constituye una oferta comercial.",
    type: "PRICE_DISCOUNT",
    status: "ACTIVE",
    discountCents: 1_000_000_00,
    tradeInBonusCents: 0,
    stackable: false,
    normalConditionsSnapshotJson: JSON.stringify({
      vehicleId: "veh-tcross-2022",
      normalPriceCents: 32_800_000_00,
      fixture: true,
      demo: true,
    }),
    startsAt,
    endsAt,
    publishedAt: startsAt,
  };
}

export const createOfferFixture = createPromotionFixture;

export const DEMO_FINANCE_DISCLAIMER =
  "TARIFARIO DEMO: valores ficticios para previsualización. No constituye una oferta, aprobación ni condición comercial real.";

export function createFinancePlanVersionFixture(
  now = new Date(),
): typeof financePlanVersions.$inferInsert {
  const validFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "finance-plan-demo-preview",
    version: "DEMO-PREVIEW-V1",
    name: "DEMO — Plan ilustrativo de previsualización",
    provider: "DEMO_NO_COMERCIAL",
    status: "PUBLISHED",
    currency: "ARS",
    pricingKind: "french",
    monthlyRateBps: 250,
    installmentCoefficientPpm: null,
    maxFinanceRatioBps: 7000,
    minimumDownPaymentRatioBps: 2500,
    allowedVehicleTypesJson: JSON.stringify(["car", "suv", "pickup"]),
    maxVehicleAgeYears: 10,
    comfortablePaymentMarginBps: 1000,
    isDemo: true,
    disclaimer: DEMO_FINANCE_DISCLAIMER,
    validFrom,
    validUntil,
    publishedAt: validFrom,
  };
}

export function createFinancePlanTierFixtures(): Array<typeof financePlanTiers.$inferInsert> {
  return [12, 18, 24].map((termMonths, index) => ({
    id: `finance-plan-demo-tier-${termMonths}`,
    financePlanVersionId: "finance-plan-demo-preview",
    termMonths,
    minAmountCents: 3_000_000_00,
    maxAmountCents: 22_000_000_00,
    sortOrder: index,
  }));
}

export function createSimulationFixture(now = new Date()): typeof simulations.$inferInsert {
  return {
    id: "simulation-demo-001",
    publicCode: "JD-DEMO1",
    idempotencyKey: "fixture-simulation-001",
    leadId: leadFixture.id,
    vehicleId: "veh-tcross-2022",
    appraisalId: "appraisal-demo-001",
    promotionId: "promo-demo-dia",
    status: "ACTIVE",
    classification: "REQUIRES_EVALUATION",
    certaintyLevel: "T1",
    vehiclePriceCents: 32_800_000_00,
    effectivePriceCents: 31_800_000_00,
    appraisalAppliedCents: 11_500_000_00,
    cashCents: 5_000_000_00,
    financePrincipalCents: 15_300_000_00,
    currency: "ARS",
    engineVersion: "fixture-v1",
    ruleVersion: "fixture-v1",
    inputSnapshotJson: JSON.stringify({ fixture: true }),
    resultSnapshotJson: JSON.stringify({
      fixture: true,
      reason: "Pendiente de tarifario financiero real",
    }),
    disclaimerSnapshot:
      "Simulación preliminar sujeta a inspección del usado, verificación documental, disponibilidad de la unidad y aprobación crediticia.",
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function seedInitialFixtures(db: Database, now = new Date()): Promise<void> {
  const syncedAt = now.toISOString();
  const seededVehicles = stockFixtures.slice(0, 3).map((vehicle) => ({
    ...vehicle,
    lastSyncedAt: syncedAt,
    publishedAt: syncedAt,
  }));
  const promotion = createPromotionFixture(now);
  const appraisal = createAppraisalFixture(now);
  const simulation = createSimulationFixture(now);
  const financePlan = createFinancePlanVersionFixture(now);
  const financeTiers = createFinancePlanTierFixtures();

  await db.insert(businessProfiles).values(businessProfileFixture).onConflictDoNothing();
  await db.insert(vehicles).values(seededVehicles).onConflictDoNothing();
  await db
    .insert(vehiclePriceHistory)
    .values(
      seededVehicles.map((vehicle) => ({
        id: `price-${vehicle.id}-initial`,
        vehicleId: vehicle.id,
        priceCents: vehicle.priceCents,
        currency: vehicle.currency ?? "ARS",
        validFrom: syncedAt,
        changedBy: "fixture-seed",
        changeReason: "INITIAL_FIXTURE",
      })),
    )
    .onConflictDoNothing();
  await db.insert(leads).values(leadFixture).onConflictDoNothing();
  await db.insert(appraisals).values(appraisal).onConflictDoNothing();
  await db.insert(promotions).values(promotion).onConflictDoNothing();
  await db
    .insert(promotionVehicles)
    .values({ promotionId: promotion.id, vehicleId: "veh-tcross-2022", isPrimary: true })
    .onConflictDoNothing();
  await db.insert(simulations).values(simulation).onConflictDoNothing();
  await db.insert(financePlanVersions).values(financePlan).onConflictDoNothing();
  await db.insert(financePlanTiers).values(financeTiers).onConflictDoNothing();
}
