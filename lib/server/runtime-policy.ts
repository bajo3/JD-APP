export function isMissingD1BindingError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("D1 binding `DB` is unavailable");
}

export function canUseDevelopmentFixtures(error: unknown, nodeEnv: string | undefined): boolean {
  return (
    isMissingD1BindingError(error) &&
    (nodeEnv === "development" || nodeEnv === "test")
  );
}

// Rate limiting belongs at the Cloudflare/Sites edge. A per-isolate in-memory
// counter would be bypassable and is intentionally not presented as production protection.
