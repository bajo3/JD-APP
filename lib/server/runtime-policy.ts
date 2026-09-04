export function isMissingD1BindingError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("D1 binding `DB` is unavailable") ||
    ("code" in error && error.code === "D1_REMOTE_CONFIG_INVALID")
  );
}

export function canUseDevelopmentFixtures(error: unknown, nodeEnv: string | undefined): boolean {
  return (
    isMissingD1BindingError(error) &&
    (nodeEnv === "development" || nodeEnv === "test")
  );
}

// Rate limiting belongs at the hosting edge. A per-isolate in-memory
// counter would be bypassable and is intentionally not presented as production protection.
