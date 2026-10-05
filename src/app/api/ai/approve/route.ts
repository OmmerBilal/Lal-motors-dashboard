import { z } from "zod";
import { approveRequest, contextFor, rejectRequest } from "@/lib/ai/command";
import { respond } from "@/lib/ai/http";
import { ToolError } from "@/lib/ai/tools";

export const runtime = "nodejs";

/**
 * Approval of one proposal. The server re-reads the proposal from the database, revalidates the current state,
 * and only then calls the existing business RPC. Approving twice does nothing the second time.
 */
export async function POST(request: Request) {
  const parsed = z.object({ requestId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ kind: "error", category: "invalid", message: "Choose a proposal to approve." });
  try {
    return respond(await approveRequest(await contextFor(), parsed.data.requestId));
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "The approval could not be processed. Nothing was changed." });
  }
}

export async function DELETE(request: Request) {
  const parsed = z.object({ requestId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ kind: "error", category: "invalid", message: "Choose a proposal to reject." });
  try {
    return respond(await rejectRequest(await contextFor(), parsed.data.requestId));
  } catch (err) {
    if (err instanceof ToolError) return respond({ kind: "error", category: err.category, message: err.message });
    return respond({ kind: "error", category: "unknown", message: "The rejection could not be processed." });
  }
}
