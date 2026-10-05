import "server-only";
import { PROGRESS_LABELS, OPERATION_CEILING_MS, TIMEOUT_MESSAGE, type ProgressEvent, type ProgressStage } from "@/lib/ai/progress";
import { contextFor } from "@/lib/ai/command";
import { ToolError, type ToolContext } from "@/lib/ai/tools";

/**
 * Newline-delimited JSON progress for one AI operation. The pipeline calls emit() when a real step starts, so the
 * browser shows true stages. Ceiling: a read or proposal that runs past OPERATION_CEILING_MS ends with a controlled
 * timeout. Approval writes are NOT raced against that ceiling, because a timed-out write could still land after the
 * user was told it failed. Those writes are bounded by the database itself and are recorded as executed or failed.
 */
export type Outcome = { kind: string; category?: string; message?: string } & Record<string, unknown>;

export function streamOperation(
  run: (emit: (stage: ProgressStage) => void) => Promise<Outcome>,
  opts: { ceiling: boolean; first?: ProgressStage },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: ProgressEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const emit = (stage: ProgressStage) => write({ type: "progress", stage, label: PROGRESS_LABELS[stage] });
      emit(opts.first ?? "understanding");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = run(emit);
        const outcome = opts.ceiling
          ? await Promise.race([
              work,
              new Promise<Outcome>((resolve) => {
                timer = setTimeout(() => resolve({ kind: "error", category: "timeout", message: TIMEOUT_MESSAGE }), OPERATION_CEILING_MS);
              }),
            ])
          : await work;
        if (outcome.kind === "error") {
          write({ type: "error", category: String(outcome.category ?? "unknown"), message: String(outcome.message ?? TIMEOUT_MESSAGE) });
        } else {
          // A proposal waits for a person, so it is not completed yet. Its last stage is approval_required.
          if (outcome.kind !== "proposal") emit("completed");
          write({ type: "result", result: outcome });
        }
      } catch {
        write({ type: "error", category: "unknown", message: "The AI service failed. Nothing was changed. Try again later." });
      } finally {
        if (timer) clearTimeout(timer);
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

/** Session check for a streamed operation. Returns a controlled error instead of throwing, so the stream can end cleanly. */
export async function authenticate(): Promise<{ ok: true; value: ToolContext } | { ok: false; error: Outcome }> {
  try {
    return { ok: true, value: await contextFor() };
  } catch (err) {
    if (err instanceof ToolError) return { ok: false, error: { kind: "error", category: err.category, message: err.message } };
    return { ok: false, error: { kind: "error", category: "unknown", message: "Sign in again." } };
  }
}
