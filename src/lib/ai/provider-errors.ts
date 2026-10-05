import "server-only";

/**
 * Safe, user-facing categories for provider failures. Messages never include the key, the raw provider body, or
 * request content. Each category maps to one controlled message; the UI shows it and performs no fake result.
 */
export type AiErrorCategory =
  | "not_configured" | "invalid_key" | "forbidden" | "rate_limited" | "quota" | "timeout" | "network"
  | "model_unavailable" | "invalid_response" | "unknown";

export const AI_ERROR_MESSAGE: Record<AiErrorCategory, string> = {
  not_configured: "The AI service is not configured on the server. Set the OpenAI key in the server environment and restart the app.",
  invalid_key: "AI service is currently unavailable. Check the OpenAI configuration and try again.",
  forbidden: "AI service is currently unavailable. Check the OpenAI configuration and try again.",
  rate_limited: "The AI service is busy. Wait a moment and try again.",
  quota: "The AI service has no remaining quota or billing is inactive. Check the OpenAI account and try again.",
  timeout: "The AI service did not answer in time. Try again.",
  network: "The AI service could not be reached. Try again when the connection is back.",
  model_unavailable: "The AI model is unavailable right now. Try again later.",
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
