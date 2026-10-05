import { NextResponse } from "next/server";
import { contextFor } from "@/lib/ai/command";
import { analyzeImage } from "@/lib/ai/analyze";
import { respond } from "@/lib/ai/http";
import { ToolError } from "@/lib/ai/tools";

export const runtime = "nodejs";

/** Plain JSON form of the analysis. The streaming form lives at /api/ai/analyze/stream. */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await contextFor();
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "Sign in again." });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return respond({ kind: "error", category: "invalid", message: "Choose what to analyse." });
  const out = await analyzeImage(ctx, form);
  if (out.kind === "error") return respond({ kind: "error", category: out.category, message: out.message } as never);
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
