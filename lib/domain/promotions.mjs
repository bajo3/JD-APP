import {
  compareMoney,
  sumMoney,
  zeroMoney,
} from "./money.mjs";
import { isWithinValidity } from "./financing.mjs";

const CURRENT_STATES = new Set(["ACTIVE", "SCHEDULED"]);

export function isPromotionEffective(promotion, vehicleId, at) {
  return (
    CURRENT_STATES.has(promotion.state) &&
    isWithinValidity(promotion, at) &&
    (promotion.vehicleIds.length === 0 ||
      promotion.vehicleIds.includes(vehicleId))
  );
}

export function selectActivePromotions(promotions, vehicleId, at) {
  const candidates = promotions
    .filter((promotion) => isPromotionEffective(promotion, vehicleId, at))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        Date.parse(left.validFrom) - Date.parse(right.validFrom) ||
        left.id.localeCompare(right.id),
    );
  if (candidates.length === 0) return Object.freeze([]);

  const selected = [candidates[0]];
  if (candidates[0].stackable) {
    for (const candidate of candidates.slice(1)) {
      if (candidate.stackable) selected.push(candidate);
    }
  }
  return Object.freeze(selected);
}

export function promotionBenefits(promotions, price, hasTradeIn) {
  const currency = price.currency;
  const priceDiscounts = promotions
    .filter((promotion) => promotion.benefit.kind === "price_discount")
    .map((promotion) => promotion.benefit.amount);
  const tradeInBonuses = hasTradeIn
    ? promotions
        .filter((promotion) => promotion.benefit.kind === "trade_in_bonus")
        .map((promotion) => promotion.benefit.amount)
    : [];

  const rawDiscount = sumMoney(priceDiscounts, currency);
  const priceDiscount = compareMoney(rawDiscount, price) > 0 ? price : rawDiscount;
  return Object.freeze({
    priceDiscount,
    tradeInBonus: sumMoney(tradeInBonuses, currency),
    financingPlanIds: Object.freeze(
      promotions
        .filter((promotion) => promotion.benefit.kind === "financing_plan")
        .map((promotion) => promotion.benefit.planId),
    ),
    hasBenefits:
      !priceDiscount.equals(zeroMoney(currency)) ||
      tradeInBonuses.length > 0 ||
      promotions.some(
        (promotion) => promotion.benefit.kind === "financing_plan",
      ),
  });
}
