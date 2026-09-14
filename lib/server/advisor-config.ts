export function advisorIsConfigured(apiKey?: string): boolean {
  return (apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim().length >= 16;
}
