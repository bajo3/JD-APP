function validKey(value?: string): boolean {
  return (value ?? "").trim().length >= 16;
}

export function advisorIsConfigured(apiKey?: string): boolean {
  if (apiKey !== undefined) return validKey(apiKey);
  return validKey(process.env.OPENAI_API_KEY) || validKey(process.env.ANTHROPIC_API_KEY);
}

export function configuredAdvisorProvider(): "openai" | "anthropic" | null {
  if (validKey(process.env.OPENAI_API_KEY)) return "openai";
  if (validKey(process.env.ANTHROPIC_API_KEY)) return "anthropic";
  return null;
}
