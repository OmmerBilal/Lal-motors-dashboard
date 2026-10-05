import { z } from "zod";
import { runCommandText, runTool } from "@/lib/ai/command";
import { authenticate, streamOperation } from "@/lib/ai/stream";
import { respond } from "@/lib/ai/http";

export const runtime = "nodejs";

/** Streamed command: named-tool routing with real stage events. Same body rules as /api/ai/command. */
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
  // The stream opens at once; the session check runs inside it so the user sees a stage without waiting.
  return streamOperation(async (emit) => {
    const ctx = await authenticate();
    if (!ctx.ok) return ctx.error;
    return "text" in parsed.data
      ? runCommandText(ctx.value, parsed.data.text, emit)
      : runTool(ctx.value, parsed.data.tool, parsed.data.arguments ?? {}, emit);
  }, { ceiling: true });
}
