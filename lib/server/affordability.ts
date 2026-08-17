import {
  ApplicationContractError,
  createFixtureApplicationRecords,
} from "@/lib/application/index.mjs";
import type { DataAccess } from "./data-access";
import { ApiError } from "./api";
import { financeRulesetVersion, requireCurrentFinancePlans } from "./finance-policy";

export async function applicationDependencies(access: DataAccess, now: Date) {
  const fixture = access.source === "fixture" ? createFixtureApplicationRecords() : null;
  const [vehicles, promotion, profile, persistedPlans] = await Promise.all([
    access.stock.listAvailable(),
    access.promotions.findCurrent(now),
    access.businessProfile.get(),
    access.source === "d1" ? access.financingPlans?.listCurrent(now) : Promise.resolve(null),
  ]);
  const unavailable = () =>
    new ApiError(
      503,
      "FINANCE_RULES_UNAVAILABLE",
      "El tarifario financiero todavía no está publicado.",
    );
  const plans = fixture
    ? requireCurrentFinancePlans(fixture.plans, unavailable)
    : requireCurrentFinancePlans(persistedPlans, unavailable);
  const rulesetVersion = fixture
    ? fixture.rulesetVersion
    : financeRulesetVersion(plans);
  const comfortablePaymentMarginBps = fixture
    ? fixture.comfortablePaymentMarginBps
    : Math.max(...(persistedPlans ?? []).map((plan) => plan.comfortablePaymentMarginBps));
  return {
    records: {
      vehicles,
      plans,
      promotions: promotion ? [promotion] : [],
      rulesetVersion,
      comfortablePaymentMarginBps,
    },
    stockFreshnessMinutes: profile?.stockFreshnessMinutes ?? 1440,
    clock: () => now,
  };
}

export function rethrowApplicationError(error: unknown): never {
  if (error instanceof ApplicationContractError) {
    throw new ApiError(422, "INVALID_OPERATION_INPUT", error.message, {
      ...(error.field ? { [error.field]: error.code } : {}),
    });
  }
  throw error;
}
