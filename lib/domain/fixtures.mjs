import { moneyFromMajor } from "./money.mjs";

export const fixtureClock = "2026-08-16T15:00:00.000Z";

export const fixturePlans = Object.freeze([
  Object.freeze({
    id: "plan-banco-jd-24",
    version: "2026-08-r1",
    name: "Prendario tasa fija",
    enabled: true,
    validFrom: "2026-08-01T03:00:00.000Z",
    validUntil: "2026-09-01T03:00:00.000Z",
    allowedTerms: Object.freeze([12, 18, 24]),
    minAmount: moneyFromMajor(3_000_000n),
    maxAmount: moneyFromMajor(22_000_000n),
    maxFinanceRatioBps: 7_000,
    minimumDownPaymentRatioBps: 2_500,
    allowedVehicleTypes: Object.freeze(["car", "suv", "pickup"]),
    maxVehicleAgeYears: 8,
    pricing: Object.freeze({ kind: "french", monthlyRateBps: 220 }),
  }),
  Object.freeze({
    id: "plan-coeficiente-36",
    version: "2026-08-r2",
    name: "Financiación 36 cuotas",
    enabled: true,
    validFrom: "2026-08-01T03:00:00.000Z",
    validUntil: "2026-09-01T03:00:00.000Z",
    allowedTerms: Object.freeze([36]),
    minAmount: moneyFromMajor(5_000_000n),
    maxAmount: moneyFromMajor(18_000_000n),
    maxFinanceRatioBps: 6_000,
    minimumDownPaymentRatioBps: 3_000,
    allowedVehicleTypes: Object.freeze(["car", "suv"]),
    maxVehicleAgeYears: 6,
    pricing: Object.freeze({
      kind: "coefficient",
      installmentCoefficientPpm: 47_850,
    }),
  }),
  Object.freeze({
    id: "plan-jd-flash-cero-12",
    version: "2026-08-flash-1",
    name: "JD Flash 12 cuotas tasa cero",
    enabled: true,
    validFrom: "2026-08-16T03:00:00.000Z",
    validUntil: "2026-08-17T03:00:00.000Z",
    allowedTerms: Object.freeze([12]),
    minAmount: moneyFromMajor(3_000_000n),
    maxAmount: moneyFromMajor(12_000_000n),
    maxFinanceRatioBps: 4_000,
    minimumDownPaymentRatioBps: 4_000,
    allowedVehicleTypes: Object.freeze(["car"]),
    maxVehicleAgeYears: 4,
    requiresPromotionId: "promo-cronos-tasa-cero",
    pricing: Object.freeze({ kind: "french", monthlyRateBps: 0 }),
  }),
]);

const commonValidity = Object.freeze({
  validFrom: "2026-08-16T12:00:00.000Z",
  validUntil: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-16T14:30:00.000Z",
});

export const fixtureSnapshots = Object.freeze([
  Object.freeze({
    vehicle: Object.freeze({
      id: "veh-cronos-2024",
      slug: "fiat-cronos-drive-2024",
      brand: "Fiat",
      model: "Cronos Drive 1.3",
      year: 2024,
      type: "car",
      available: true,
      price: moneyFromMajor(27_500_000n),
      financeableFees: moneyFromMajor(650_000n),
      nonFinanceableFees: moneyFromMajor(350_000n),
      ...commonValidity,
    }),
    promotions: Object.freeze([
      Object.freeze({
        id: "promo-cronos-tasa-cero",
        version: "1",
        state: "ACTIVE",
        priority: 100,
        stackable: false,
        vehicleIds: Object.freeze(["veh-cronos-2024"]),
        validFrom: "2026-08-16T03:00:00.000Z",
        validUntil: "2026-08-17T03:00:00.000Z",
        benefit: Object.freeze({
          kind: "financing_plan",
          planId: "plan-jd-flash-cero-12",
        }),
      }),
    ]),
  }),
  Object.freeze({
    vehicle: Object.freeze({
      id: "veh-corolla-2022",
      slug: "toyota-corolla-xei-2022",
      brand: "Toyota",
      model: "Corolla XEI CVT",
      year: 2022,
      type: "car",
      available: true,
      price: moneyFromMajor(31_800_000n),
      financeableFees: moneyFromMajor(720_000n),
      nonFinanceableFees: moneyFromMajor(380_000n),
      ...commonValidity,
    }),
    promotions: Object.freeze([]),
  }),
  Object.freeze({
    vehicle: Object.freeze({
      id: "veh-tcross-2023",
      slug: "volkswagen-t-cross-comfortline-2023",
      brand: "Volkswagen",
      model: "T-Cross Comfortline",
      year: 2023,
      type: "suv",
      available: true,
      price: moneyFromMajor(34_900_000n),
      financeableFees: moneyFromMajor(790_000n),
      nonFinanceableFees: moneyFromMajor(410_000n),
      ...commonValidity,
    }),
    promotions: Object.freeze([
      Object.freeze({
        id: "promo-tcross-precio-dia",
        version: "1",
        state: "ACTIVE",
        priority: 80,
        stackable: false,
        vehicleIds: Object.freeze(["veh-tcross-2023"]),
        validFrom: "2026-08-16T03:00:00.000Z",
        validUntil: "2026-08-17T03:00:00.000Z",
        benefit: Object.freeze({
          kind: "price_discount",
          amount: moneyFromMajor(1_200_000n),
        }),
      }),
    ]),
  }),
  Object.freeze({
    vehicle: Object.freeze({
      id: "veh-ranger-2021",
      slug: "ford-ranger-xls-2021",
      brand: "Ford",
      model: "Ranger XLS 4x2",
      year: 2021,
      type: "pickup",
      available: false,
      price: moneyFromMajor(39_800_000n),
      financeableFees: moneyFromMajor(850_000n),
      nonFinanceableFees: moneyFromMajor(450_000n),
      ...commonValidity,
    }),
    promotions: Object.freeze([]),
  }),
]);

export const fixtureRuleset = Object.freeze({
  version: "rules-2026-08-16",
  comfortablePaymentMarginBps: 1_000,
  plans: fixturePlans,
});

export const fixtureInput = Object.freeze({
  at: fixtureClock,
  cash: moneyFromMajor(4_000_000n),
  accreditedDeposit: moneyFromMajor(0n),
  maxMonthlyPayment: moneyFromMajor(1_250_000n),
  acceptedTerms: Object.freeze([12, 18, 24, 36]),
  appraisal: Object.freeze({
    low: moneyFromMajor(16_500_000n),
    base: moneyFromMajor(17_500_000n),
    high: moneyFromMajor(18_200_000n),
    certainty: "T1",
    requiresReview: false,
    validUntil: "2026-08-18T03:00:00.000Z",
  }),
  preferences: Object.freeze({
    preferredBrands: Object.freeze(["Toyota", "Fiat"]),
    preferredVehicleTypes: Object.freeze(["car"]),
  }),
});
