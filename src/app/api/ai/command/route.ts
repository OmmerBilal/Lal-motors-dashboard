import { NextResponse } from "next/server";
import { z } from "zod";
import { contextFor, runCommandText, runTool, type CommandResult } from "@/lib/ai/command";
import { respond } from "@/lib/ai/http";
import { ToolError } from "@/lib/ai/tools";

export const runtime = "nodejs";

/**
 * Command Center entry point. Runs only from an explicit user submit (never on page load). Body is either
 * { text } for a model-routed command, or { tool, arguments } for an explicitly chosen tool.
 */
const body = z.union([
  z.object({ text: z.string().min(3).max(1000) }).strict(),
  z.object({ tool: z.string().min(1).max(60), arguments: z.record(z.string(), z.unknown()).optional() }).strict(),
]);

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respond({ kind: "error", category: "invalid", message: "Send a JSON body." });
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) return respond({ kind: "error", category: "invalid", message: "The command is not in the expected shape. Nothing was done." });
  let result: CommandResult;
  try {
    const ctx = await contextFor();
    result = "text" in parsed.data
      ? await runCommandText(ctx, parsed.data.text)
      : await runTool(ctx, parsed.data.tool, parsed.data.arguments ?? {});
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return NextResponse.json({ kind: "error", error: { category: "unknown", message: "The command could not be processed. Nothing was changed." } }, { status: 500 });
  }
  return respond(result);
}

/** The caller's own recent requests (no other person's). Read-only; it never runs a tool. */
export async function GET() {
  try {
    const ctx = await contextFor();
    const { data, error } = await ctx.supabase.rpc("ai_list_my_requests", { p_limit: 20 });
    if (error) return respond({ kind: "error", category: "forbidden", message: "Your history could not be loaded." });
    return NextResponse.json({ kind: "history", rows: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "Sign in again." });
  }
}
