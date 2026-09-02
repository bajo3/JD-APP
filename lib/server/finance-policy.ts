import { isFinanceableCurrency } from "../domain/financing.mjs";

export function requireCurrentFinancePlans<T>(
  plans: readonly T[] | null | undefined,
  unavailable: () => Error,
): readonly T[] {
  if (!plans || plans.length === 0) {
    throw unavailable();
  }
  return plans;
}

export function financeRulesetVersion(plans: ReadonlyArray<{ version: string }>): string {
  return `d1:${plans.map((plan) => plan.version).sort().join("+")}`;
}

export function isFinanceableVehicle(vehicle: { currency: string }): boolean {
  return isFinanceableCurrency(vehicle.currency);
}
