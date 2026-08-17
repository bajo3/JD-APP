import assert from "node:assert/strict";
import test from "node:test";

import {
  isPromotionEffective,
  moneyFromMajor,
  promotionBenefits,
  selectActivePromotions,
} from "../lib/domain/index.mjs";

function promotion(overrides = {}) {
  return {
    id: "promo-a",
    state: "SCHEDULED",
    priority: 10,
    stackable: false,
    vehicleIds: ["vehicle-a"],
    validFrom: "2026-08-16T12:00:00.000Z",
    validUntil: "2026-08-16T18:00:00.000Z",
    benefit: { kind: "price_discount", amount: moneyFromMajor(1_000_000n) },
    ...overrides,
  };
}

test("promotion validity is server-time based with an exclusive end", () => {
  const subject = promotion();
  assert.equal(
    isPromotionEffective(subject, "vehicle-a", "2026-08-16T12:00:00.000Z"),
    true,
  );
  assert.equal(
    isPromotionEffective(subject, "vehicle-a", "2026-08-16T18:00:00.000Z"),
    false,
  );
  assert.equal(
    isPromotionEffective(subject, "vehicle-b", "2026-08-16T15:00:00.000Z"),
    false,
  );
});

test("non-stackable priority wins and stackable benefits remain explicit", () => {
  const selected = selectActivePromotions(
    [
      promotion({ id: "lower", priority: 5, stackable: true }),
      promotion({ id: "winner", priority: 20, stackable: false }),
    ],
    "vehicle-a",
    "2026-08-16T15:00:00.000Z",
  );
  assert.deepEqual(selected.map(({ id }) => id), ["winner"]);

  const stack = selectActivePromotions(
    [
      promotion({ id: "discount", priority: 20, stackable: true }),
      promotion({
        id: "trade",
        priority: 10,
        stackable: true,
        benefit: { kind: "trade_in_bonus", amount: moneyFromMajor(500_000n) },
      }),
    ],
    "vehicle-a",
    "2026-08-16T15:00:00.000Z",
  );
  const benefits = promotionBenefits(stack, moneyFromMajor(10_000_000n), true);
  assert.equal(benefits.priceDiscount.minorUnits, 100_000_000);
  assert.equal(benefits.tradeInBonus.minorUnits, 50_000_000);
});
