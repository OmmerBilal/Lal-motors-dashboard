import { analyzeImage } from "@/lib/ai/analyze";
import { authenticate, streamOperation } from "@/lib/ai/stream";
import { respond } from "@/lib/ai/http";

export const runtime = "nodejs";

/** Streamed analysis: real stages as NDJSON, bounded by the operation ceiling. Errors before streaming stay JSON. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return respond({ kind: "error", category: "invalid", message: "Choose what to analyse." });
  return streamOperation(async (emit) => {
    const ctx = await authenticate();
    if (!ctx.ok) return ctx.error;
    return analyzeImage(ctx.value, form, emit);
  }, { ceiling: true, first: "preparing_image" });
}
