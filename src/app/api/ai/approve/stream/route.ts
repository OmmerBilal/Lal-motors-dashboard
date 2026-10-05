import { z } from "zod";
import { approveRequest } from "@/lib/ai/command";
import { authenticate, streamOperation } from "@/lib/ai/stream";
import { respond } from "@/lib/ai/http";

export const runtime = "nodejs";

/**
 * Streamed approval. Approval is a person's decision, so the stream has no provider timer and no ceiling: the
 * database step is bounded itself, and every outcome is recorded as executed, failed or stale.
 */
const body = z.object({ requestId: z.uuid() }).strict();

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ kind: "error", category: "invalid", message: "Choose a proposal to approve." });
  return streamOperation(async (emit) => {
    const ctx = await authenticate();
    if (!ctx.ok) return ctx.error;
    return approveRequest(ctx.value, parsed.data.requestId, emit);
  }, { ceiling: false, first: "checking_state" });
}
