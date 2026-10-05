"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageInput } from "@/components/media/image-input";
import { readProgressStream } from "@/lib/ai/client-stream";
import { PROGRESS_LABELS, SLOW_MESSAGE, SLOW_WARNING_MS, type ProgressEvent } from "@/lib/ai/progress";
import { emptyVehicleDraft, vehicleFieldLabels, vehicleFieldOrder } from "@/lib/mock/vehicles";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

const methods: { id: IntakeMethod; label: string }[] = [
  { id: "bulk", label: "Bulk Paste" },
  { id: "single", label: "Single Paste" },
  { id: "scan", label: "AI Photo / Screenshot Scan" },
  { id: "manual", label: "Manual Entry" },
];

type Candidate = { vin: string; lot_number: string; stock_number: string; year: number; make: string; model: string; confidence: number };

/** Text for one candidate, in the same form a person would paste. The review then matches it against the database. */
function candidateText(c: Candidate) {
  return [c.vin, c.lot_number && `Lot ${c.lot_number}`, c.stock_number && `Stock ${c.stock_number}`, c.year || "", c.make, c.model]
    .filter((x) => String(x ?? "").trim() !== "")
    .join(" ");
}

export function IntakeView({
  method,
  onChangeMethod,
  onAnalyzed,
  canScan,
  initialSource,
  onSourceChange,
}: {
  method: IntakeMethod;
  onChangeMethod: (m: IntakeMethod) => void;
  onAnalyzed: (sourceText: string, method?: IntakeMethod) => void;
  canScan: boolean;
  initialSource: string;
  onSourceChange: (text: string) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [manual, setManual] = useState<Record<string, string>>({ ...emptyVehicleDraft });
  const [image, setImage] = useState<File | null>(null);
  const [scan, setScan] = useState<{ phase: "idle" | "running" | "done" | "failed"; label: string | null; startedAt: number; elapsedMs: number; candidates: Candidate[] | null; uncertainty: string; error: string | null }>({
    phase: "idle", label: null, startedAt: 0, elapsedMs: 0, candidates: null, uncertainty: "", error: null,
  });
  const busy = scan.phase === "running";
  const elapsedSec = Math.floor(scan.elapsedMs / 1000);
  const slow = busy && scan.elapsedMs >= SLOW_WARNING_MS;

  function setText(next: string) {
    setSource(next);
    onSourceChange(next);
  }

  /** The real screenshot path: compressed on the server, analysed once, shown as candidates. Nothing is created here. */
  async function analyseScreenshot(file: File) {
    const startedAt = Date.now();
    setScan({ phase: "running", label: PROGRESS_LABELS.preparing_image, startedAt, elapsedMs: 0, candidates: null, uncertainty: "", error: null });
    const form = new FormData();
    form.append("purpose", "auction_screenshot");
    form.append("image", file);
    const timer = window.setInterval(() => setScan((s) => ({ ...s, elapsedMs: Date.now() - startedAt })), 500);
    const outcome = await readProgressStream("/api/ai/analyze/stream", { body: form }, (event: ProgressEvent) => {
      if (event.type === "progress") setScan((s) => ({ ...s, label: event.label }));
    });
    window.clearInterval(timer);
    const elapsedMs = Date.now() - startedAt;
    if (outcome.kind === "error") {
      setScan((s) => ({ ...s, phase: "failed", elapsedMs, error: outcome.message, label: null }));
      return;
    }
    const result = outcome.result as unknown as { result: { candidates?: Candidate[]; uncertainty?: string } };
    setScan((s) => ({
      ...s,
      phase: "done",
      elapsedMs,
      label: null,
      candidates: result.result.candidates ?? [],
      uncertainty: result.result.uncertainty ?? "",
      error: null,
    }));
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {methods.map((m) => (
          <Button
            key={m.id}
            type="button"
            size="sm"
            className="min-h-11"
            variant={method === m.id ? "default" : "outline"}
            onClick={() => {
              onChangeMethod(m.id);
              setScan({ phase: "idle", label: null, startedAt: 0, elapsedMs: 0, candidates: null, uncertainty: "", error: null });
            }}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {method === "manual" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicleFieldOrder.map((key) => (
            <div key={key} className="space-y-1.5">
              <Label>{vehicleFieldLabels[key]}</Label>
              <Input className="min-h-11" value={manual[key] ?? ""} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} />
            </div>
          ))}
        </div>
      ) : method === "scan" ? (
        <div className="space-y-4">
          {!canScan ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              AI screenshot scan is for managers and admins. Use Bulk Paste, Single Paste or Manual Entry.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Take a photo of the auction screen or choose a screenshot. The reading is a draft. You check each candidate before anything is added.
              </p>
              <ImageInput
                label="Auction screen photo or screenshot (up to 10 MB)"
                onChange={setImage}
                onUse={(file) => analyseScreenshot(file)}
                useLabel={busy ? "Reading…" : "Read this screen"}
                disabled={busy}
              />
              {image && !busy && scan.phase === "idle" && <p className="text-xs text-muted-foreground">Selected: {image.name}</p>}
              {busy && (
                <div className="rounded-md border border-border bg-card p-3 text-sm" aria-live="polite">
                  <p className="font-medium">{scan.label}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{elapsedSec}s</p>
                  {slow && <p className="mt-1 text-xs text-warning-foreground">{SLOW_MESSAGE}</p>}
                </div>
              )}
              {scan.phase === "failed" && scan.error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {scan.error} You can still type the details in Single Paste.
                </p>
              )}
              {scan.phase === "done" && scan.candidates && (
                <section className="space-y-3" aria-live="polite">
                  <p className="text-sm font-semibold">Candidates from this screen · {scan.candidates.length}</p>
                  {scan.candidates.length === 0 && <p className="text-sm text-muted-foreground">No vehicle details were readable. Try a clearer photo or use Single Paste.</p>}
                  {scan.uncertainty && <p className="text-xs text-muted-foreground">Uncertain: {scan.uncertainty}</p>}
                  {scan.candidates.map((c, i) => (
                    <div key={i} className="space-y-2 rounded-md border border-border bg-card p-3">
                      <p className="font-medium">{[c.year, c.make, c.model].filter(Boolean).join(" ") || "Unknown vehicle"}</p>
                      <p className="text-xs text-muted-foreground">
                        VIN {c.vin || "—"} · Lot {c.lot_number || "—"} · Stock {c.stock_number || "—"} · Confidence {Math.round(Number(c.confidence) * 100)}%
                      </p>
                      <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => onAnalyzed(candidateText(c), "single")}>
                        Check this vehicle
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Checking matches the vehicle against existing records. Nothing is added until you confirm it there.</p>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="intake-source">Paste auction data</Label>
          <Textarea
            id="intake-source"
            rows={method === "bulk" ? 12 : 7}
            value={source}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              method === "bulk"
                ? "Paste the entire list of purchased vehicles here. Do not separate them manually."
                : "Paste one vehicle's auction information here."
            }
          />
        </div>
      )}

      {method !== "scan" && (
        <div>
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={busy || (method === "manual" ? false : source.trim().length === 0)}
            onClick={() => onAnalyzed(method === "manual" ? JSON.stringify(manual) : source)}
          >
            {method === "manual" ? "Review vehicle" : "Check vehicles"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">Nothing enters inventory until you confirm the reviewed vehicle.</p>
        </div>
      )}
    </div>
  );
}
