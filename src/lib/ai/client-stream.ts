"use client";

import type { ProgressEvent } from "@/lib/ai/progress";

/**
 * Browser reader for the NDJSON progress stream. Each line is one truthful event from the server pipeline.
 * Resolves with the final result or error. A non-stream answer (for example a 401 JSON body) is read as a plain answer.
 */
export type StreamOutcome =
  | { kind: "result"; result: Record<string, unknown> & { kind: string } }
  | { kind: "error"; category: string; message: string };

export async function readProgressStream(
  url: string,
  init: { body: BodyInit; headers?: Record<string, string> },
  onEvent: (event: ProgressEvent) => void,
): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", credentials: "same-origin", ...init });
  } catch {
    return { kind: "error", category: "network", message: "AI service unavailable: the connection failed. Nothing was applied. Try again." };
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("ndjson") || !res.body) {
    const json = (await res.json().catch(() => null)) as { kind?: string; error?: { category: string; message: string } } | null;
    if (json?.kind === "error" && json.error) return { kind: "error", category: json.error.category, message: json.error.message };
    return { kind: "error", category: "unknown", message: "The AI service failed. Nothing was changed. Try again later." };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: StreamOutcome | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ProgressEvent;
      onEvent(event);
      if (event.type === "result") final = { kind: "result", result: event.result as Record<string, unknown> & { kind: string } };
      if (event.type === "error") final = { kind: "error", category: event.category, message: event.message };
    }
    if (done) break;
  }
  return final ?? { kind: "error", category: "unknown", message: "The AI service stopped before it finished. Nothing was changed." };
}
