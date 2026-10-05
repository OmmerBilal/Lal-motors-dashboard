import "server-only";

/**
 * Server-only OpenAI configuration. The key is read here and nowhere else, and it is never returned to a caller,
 * logged, or placed in a response. The configured variable is OpenAI_key; OPENAI_API_KEY is accepted as a fallback.
 * Neither is NEXT_PUBLIC_, so the browser bundle cannot contain them.
 */
export type AiConfigState = { configured: boolean; model: string; transcriptionModel: string };

export function getOpenAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY || process.env.OpenAI_key || "";
  return k.trim().length > 0 ? k.trim() : null;
}

export function aiConfigState(): AiConfigState {
  return {
    configured: getOpenAiKey() !== null,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
  };
}
