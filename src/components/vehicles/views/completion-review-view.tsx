"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/patterns/empty-state";
import { useDecideCompletion, usePendingCompletions } from "@/lib/query/vehicle-workspace";

/**
 * Completion submissions waiting for a reviewer. The VIN check below stops a mis-click in the browser only;
 * the database checks the role, the correction reason and that a submission is decided once.
 */
export function CompletionReviewView({ onOpenVehicle }: { onOpenVehicle: (id: string) => void }) {
  const queue = usePendingCompletions();
  const decide = useDecideCompletion();
  const [typedVin, setTypedVin] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>("");
  const items = queue.data ?? [];

  function errorText(err: unknown) {
    return err instanceof Error ? err.message : "The decision was not saved. Nothing was changed.";
  }

  function approve(id: string) {
    setError("");
    decide.mutate({ completionId: id, decision: "approved", reason: "" }, { onError: (e) => setError(errorText(e)) });
  }

  function sendBack(id: string) {
    setError("");
    decide.mutate({ completionId: id, decision: "needs_correction", reason: reason[id] ?? "" }, { onError: (e) => setError(errorText(e)) });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Vehicles waiting for completion review · {queue.isSuccess ? items.length : "…"}</h3>
      </div>
      <p className="text-sm text-muted-foreground">Check the vehicle&apos;s VIN before you confirm. Only your decision closes a completion.</p>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {queue.isPending && <p className="text-sm text-muted-foreground">Loading submissions…</p>}
      {queue.isError && <p role="alert" className="text-sm text-destructive">The review queue could not be loaded.</p>}

      {items.map((item) => {
        const v = item.vehicles;
        const vinMatches = Boolean(v?.vin) && typedVin[item.id]?.trim().toUpperCase() === v?.vin?.toUpperCase();
        return (
          <article key={item.id} className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <b className="block text-sm">{v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "Vehicle"}</b>
              <p className="text-xs text-muted-foreground">VIN {v?.vin || "—"}</p>
              <small className="mt-1 block text-xs text-muted-foreground">
                {new Date(item.submitted_at).toLocaleString()} · {item.part_count} parts · {item.converter_count} converters ·{" "}
                {item.custody_exceptions} custody exceptions
              </small>
              {item.note && <p className="mt-2 text-sm">{item.note}</p>}
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onOpenVehicle(item.vehicle_id)}>
                Open vehicle, parts &amp; history
              </Button>

              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`id-${item.id}`}>Type the VIN to confirm</Label>
                  <Input
                    id={`id-${item.id}`}
                    placeholder="Exact VIN"
                    value={typedVin[item.id] ?? ""}
                    onChange={(e) => setTypedVin({ ...typedVin, [item.id]: e.target.value })}
                  />
                </div>
                <Button
                  disabled={item.custody_exceptions > 0 || !vinMatches || decide.isPending}
                  onClick={() => approve(item.id)}
                >
                  <CheckCircle2 /> Confirm vehicle completed
                </Button>
                {item.custody_exceptions > 0 && (
                  <p className="text-xs text-warning-foreground">Resolve the custody exceptions before this can be confirmed.</p>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor={`reason-${item.id}`}>Correction needed</Label>
                  <Input
                    id={`reason-${item.id}`}
                    placeholder="What needs correction? (3 to 500 characters)"
                    value={reason[item.id] ?? ""}
                    maxLength={500}
                    onChange={(e) => setReason({ ...reason, [item.id]: e.target.value })}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={(reason[item.id] ?? "").trim().length < 3 || decide.isPending}
                  onClick={() => sendBack(item.id)}
                >
                  <ShieldAlert /> Send back for correction
                </Button>
              </div>
            </div>
            <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground">
              No completion photo is linked to this submission yet.
            </div>
          </article>
        );
      })}

      {queue.isSuccess && items.length === 0 && (
        <EmptyState icon={CheckCircle2} title="Queue clear" description="No completion submissions waiting for review." />
      )}
    </div>
  );
}
