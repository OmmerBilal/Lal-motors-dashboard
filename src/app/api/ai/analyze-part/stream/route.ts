import { z } from "zod";
import { analyzePart } from "@/lib/ai/analyze-part";
import { authenticate, streamOperation } from "@/lib/ai/stream";
import { respond } from "@/lib/ai/http";

export const runtime = "nodejs";

/** Streamed "Analyze Part" for a part awaiting review. Advisory draft only: no approval, no part change. */
const body = z.object({ partId: z.uuid() }).strict();

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ kind: "error", category: "invalid", message: "Choose a part to analyse." });
  return streamOperation(async (emit) => {
    const ctx = await authenticate();
    if (!ctx.ok) return ctx.error;
    return analyzePart(ctx.value, parsed.data.partId, emit);
  }, { ceiling: true, first: "reading_context" });
}
