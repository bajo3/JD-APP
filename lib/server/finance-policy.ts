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
