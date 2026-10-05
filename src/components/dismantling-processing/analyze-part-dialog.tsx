"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readProgressStream } from "@/lib/ai/client-stream";
import { SLOW_MESSAGE, SLOW_WARNING_MS, type ProgressEvent } from "@/lib/ai/progress";

/**
 * Module 05 "Analyze Part". An explicit request by a manager. The draft is advisory: it is shown, never saved, and
 * never approves the part. Approval stays with Edit & Approve or Approve.
 */

type Draft = {
  identity: string;
  category: string;
  title: string;
  description: string;
  specifications: string[];
  fitment_suggestion: string;
  seo_title: string;
  seo_description: string;
  tags: string[];
  confidence: number;
  uncertainty: string;
};

type State =
  | { phase: "idle" }
  | { phase: "running"; labels: string[]; startedAt: number; elapsedMs: number }
  | { phase: "done"; draft: Draft; labels: string[]; cached: boolean }
  | { phase: "failed"; message: string; labels: string[] };

export function AnalyzePartDialog({
  open,
  partId,
  partLabel,
  onOpenChange,
}: {
  open: boolean;
  partId: string;
  partLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run() {
    const startedAt = Date.now();
    setState({ phase: "running", labels: [], startedAt, elapsedMs: 0 });
    const outcome = await readProgressStream(
      "/api/ai/analyze-part/stream",
      { body: JSON.stringify({ partId }), headers: { "content-type": "application/json" } },
      (event: ProgressEvent) => {
        if (event.type === "progress") {
          setState((s) => (s.phase === "running" ? { ...s, labels: [...s.labels, event.label], elapsedMs: Date.now() - startedAt } : s));
        }
      },
    );
    if (outcome.kind === "error") {
      setState((s) => ({ phase: "failed", message: outcome.message, labels: s.phase === "running" ? s.labels : [] }));
      return;
    }
    const result = outcome.result as unknown as { result: Draft; cached: boolean };
    setState((s) => ({ phase: "done", draft: result.result, cached: result.cached, labels: s.phase === "running" ? s.labels : [] }));
  }

  // Elapsed time is kept in state and refreshed while the request runs, so rendering never reads the clock.
  useEffect(() => {
    if (state.phase !== "running") return;
    const tick = window.setInterval(() => {
      setState((s) => (s.phase === "running" ? { ...s, elapsedMs: Date.now() - s.startedAt } : s));
    }, 500);
    return () => window.clearInterval(tick);
  }, [state.phase]);
  const elapsedSec = state.phase === "running" ? Math.floor(state.elapsedMs / 1000) : 0;
  const slow = state.phase === "running" && state.elapsedMs >= SLOW_WARNING_MS;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setState({ phase: "idle" });
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Analyze part
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{partLabel}</p>
        <p className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          An AI draft is advisory. It is not saved, and it does not approve the part. Use Edit &amp; Approve to record it.
        </p>

        {state.phase === "idle" && <Button className="min-h-11 w-full" onClick={run}>Analyze this part&apos;s photo</Button>}

        {(state.phase === "running" || state.phase === "done" || state.phase === "failed") && state.labels.length > 0 && (
          <ol className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
            {state.labels.map((l, i) => (
              <li key={`${i}-${l}`}>{l}</li>
            ))}
          </ol>
        )}
        {state.phase === "running" && (
          <div className="text-sm" aria-live="polite">
            <p className="font-medium">Analysing…</p>
            <p className="text-xs text-muted-foreground tabular-nums">{elapsedSec}s</p>
            {slow && <p className="text-xs text-warning-foreground">{SLOW_MESSAGE}</p>}
          </div>
        )}

        {state.phase === "failed" && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.message} Nothing was changed.
          </p>
        )}

        {state.phase === "done" && (
          <section className="space-y-3 text-sm" aria-live="polite">
            <p className="text-xs text-muted-foreground">
              Draft{state.cached ? " · from an earlier identical photo" : ""} · confidence {Math.round(state.draft.confidence * 100)}%
            </p>
            <Field label="Likely identity" value={state.draft.identity} />
            <Field label="Category" value={state.draft.category} />
            <Field label="Title" value={state.draft.title} />
            <Field label="Description" value={state.draft.description} />
            <Field label="Specifications" value={state.draft.specifications.join(" · ")} />
            <Field label="Fitment suggestion" value={state.draft.fitment_suggestion} />
            <Field label="SEO title" value={state.draft.seo_title} />
            <Field label="SEO description" value={state.draft.seo_description} />
            <Field label="Tags" value={state.draft.tags.join(", ")} />
            {state.draft.uncertainty && <Field label="Uncertain" value={state.draft.uncertainty} />}
          </section>
        )}

        <DialogFooter>
          {state.phase === "failed" && <Button variant="outline" onClick={run}>Try again</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="break-words">{value || "—"}</p>
    </div>
  );
}

