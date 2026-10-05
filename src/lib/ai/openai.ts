import "server-only";
import { getOpenAiKey, aiConfigState } from "@/lib/ai/config";
import { AiProviderError, categoryForStatus, type AiErrorCategory } from "@/lib/ai/provider-errors";

/**
 * OpenAI transport. Server only. Structured JSON output (json_schema), a per-attempt timeout, bounded retry for
 * rate-limit and server errors only, and no logging of keys, bodies or content. Tests replace this module's
 * transport; business tool execution is never replaced.
 */
const ENDPOINT = "https://api.openai.com/v1";
const TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 2;

type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }>;

export async function callStructured<T>(args: {
  system: string;
  user: ChatContent;
  schemaName: string;
  schema: Record<string, unknown>;
  parse: (raw: unknown) => T;
}): Promise<T> {
  const key = getOpenAiKey();
  if (!key) throw new AiProviderError("not_configured");
  const body = {
    model: aiConfigState().model,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: args.schemaName, strict: true, schema: args.schema } },
  };
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`${ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const providerCode = await readProviderCode(res);
      throw new AiProviderError(categoryForStatus(res.status, providerCode));
    }
    return (await res.json()) as { choices?: { message?: { content?: string } }[] };
  });
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new AiProviderError("invalid_response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiProviderError("invalid_response");
  }
  try {
    return args.parse(parsed);
  } catch {
    throw new AiProviderError("invalid_response");
  }
}

export async function transcribeAudio(file: Blob, filename: string): Promise<string> {
  const key = getOpenAiKey();
  if (!key) throw new AiProviderError("not_configured");
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", aiConfigState().transcriptionModel);
  const json = await withRetry(async () => {
    const res = await fetchWithTimeout(`${ENDPOINT}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new AiProviderError(categoryForStatus(res.status, await readProviderCode(res)));
    return (await res.json()) as { text?: string };
  });
  if (typeof json.text !== "string") throw new AiProviderError("invalid_response");
  return json.text;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const category: AiErrorCategory | null = err instanceof AiProviderError ? err.category : null;
      // Only transient failures are retried. Key, account and quota problems fail at once.
      const transient = category === "rate_limited" || category === "timeout" || category === "network" || category === "model_unavailable";
      if (!transient || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw last instanceof AiProviderError ? last : new AiProviderError("unknown");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") throw new AiProviderError("timeout");
    throw new AiProviderError("network");
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    return body.error?.code ?? null;
  } catch {
    return null;
  }
}
