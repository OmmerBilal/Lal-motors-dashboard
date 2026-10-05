import "server-only";
import { NextResponse } from "next/server";
import type { CommandResult } from "@/lib/ai/command";

/** Maps an orchestration result to an HTTP response. Errors carry a category and a message, never a stack or a key. */
export function respond(result: CommandResult) {
  if (result.kind !== "error") return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  const status = STATUS[result.category] ?? 500;
  return NextResponse.json({ kind: "error", error: { category: result.category, message: result.message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const STATUS: Record<string, number> = {
  invalid: 400,
  unknown_tool: 400,
  forbidden: 403,
  stale: 409,
  already_decided: 409,
  rejected: 422,
  not_configured: 503,
  invalid_key: 503,
  forbidden_provider: 503,
  rate_limited: 503,
  quota: 503,
  timeout: 504,
  network: 503,
  model_unavailable: 503,
  invalid_response: 502,
  unknown: 500,
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
