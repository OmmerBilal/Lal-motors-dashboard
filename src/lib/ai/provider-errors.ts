import "server-only";

/**
 * Safe, user-facing categories for provider failures. Messages never include the key, the raw provider body, or
 * request content. Each category maps to one controlled message; the UI shows it and performs no fake result.
 */
export type AiErrorCategory =
  | "not_configured" | "invalid_key" | "forbidden" | "rate_limited" | "quota" | "timeout" | "network"
  | "model_unavailable" | "invalid_response" | "unknown";

export const AI_ERROR_MESSAGE: Record<AiErrorCategory, string> = {
  not_configured: "OpenAI configuration needs attention. The AI service is not set up on the server. Nothing was applied.",
  invalid_key: "OpenAI configuration needs attention. The key was refused. Nothing was applied.",
  forbidden: "OpenAI configuration needs attention. This key cannot use the model. Nothing was applied.",
  rate_limited: "AI service unavailable: it is busy right now. Nothing was applied. Try again shortly.",
  quota: "The AI service has no remaining quota or billing is inactive. Check the OpenAI account and try again.",
  timeout: "AI took too long to respond. Your action was not applied. Try again.",
  network: "AI service unavailable: the connection failed. Nothing was applied. Try again.",
  model_unavailable: "AI service unavailable: the model did not respond. Nothing was applied. Try again later.",
  invalid_response: "The AI service returned an unexpected answer, so nothing was done. Try again or rephrase.",
  unknown: "The AI service failed. Nothing was changed. Try again later.",
};

export class AiProviderError extends Error {
  readonly category: AiErrorCategory;
  constructor(category: AiErrorCategory) {
    super(AI_ERROR_MESSAGE[category]);
    this.category = category;
  }
}

/** Maps an HTTP status and a provider error code to a category. The raw body is never kept. */
export function categoryForStatus(status: number, providerCode: string | null): AiErrorCategory {
  if (status === 401) return "invalid_key";
  if (status === 403) return "forbidden";
  if (status === 429) return providerCode === "insufficient_quota" ? "quota" : "rate_limited";
  if (status === 404 || (status === 400 && providerCode === "model_not_found")) return "model_unavailable";
  if (status >= 500) return "model_unavailable";
  return "unknown";
}
