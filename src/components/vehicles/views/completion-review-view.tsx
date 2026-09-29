"use client";

import { useState } from "react";
import { Camera, CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/patterns/empty-state";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

export function CompletionReviewView({ onOpenVehicle }: { onOpenVehicle: (id: string) => void }) {
  const { completionQueue, decideCompletion } = useVehicleData();
  const [identifier, setIdentifier] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  const grouped = completionQueue.reduce<Record<string, typeof completionQueue>>((acc, item) => {
    (acc[item.employeeName] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Vehicles waiting for completion review · {completionQueue.length}</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Compare the employee photo with the existing VIN or Lot #. AI reading is a hint; only your verification
        closes the vehicle.
      </p>

      {Object.entries(grouped).map(([name, items]) => (
        <div key={name}>
          <h4 className="mb-2 text-sm font-semibold">
            {name} — {items.length} submitted
          </h4>
          <div className="space-y-3">
            {items.map((item) => (
              <article key={item.submissionId} className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[1.4fr_1fr]">
                <div>
                  <b className="block text-sm">
                    {item.year} {item.make} {item.model}
                  </b>
                  <p className="text-xs text-muted-foreground">
                    VIN {item.vin || "—"} · Lot {item.lotNumber || "—"} · Stock {item.stockNumber || "—"}
                  </p>
                  <small className="mt-1 block text-xs text-muted-foreground">
                    {new Date(item.submittedAt).toLocaleString()} · {item.partCount} parts · {item.converterCount}{" "}
                    converters · {item.custodyExceptions} custody exceptions
                  </small>
                  <p className="mt-2 text-sm">{item.note}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => onOpenVehicle(item.vehicleId)}>
                    Open vehicle, parts & history
                  </Button>
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`id-${item.submissionId}`}>Verify VIN or Lot #</Label>
                      <Input
                        id={`id-${item.submissionId}`}
                        placeholder="Type exact VIN or Lot #"
                        value={identifier[item.submissionId] || ""}
                        onChange={(e) => setIdentifier({ ...identifier, [item.submissionId]: e.target.value })}
                      />
                    </div>
                    <Button
                      disabled={item.custodyExceptions > 0 || !identifier[item.submissionId]}
                      onClick={() => decideCompletion(item.submissionId, "approve")}
                    >
                      <CheckCircle2 /> Confirm vehicle completed
                    </Button>
                    <div className="space-y-1.5">
                      <Label htmlFor={`reason-${item.submissionId}`}>Correction reason</Label>
                      <Input
                        id={`reason-${item.submissionId}`}
                        placeholder="What needs correction?"
                        value={reason[item.submissionId] || ""}
                        onChange={(e) => setReason({ ...reason, [item.submissionId]: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={!reason[item.submissionId]?.trim()}
                      onClick={() => decideCompletion(item.submissionId, "correction", reason[item.submissionId])}
                    >
                      <ShieldAlert /> Needs correction
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2">
                  <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground">
                    <Camera className="mr-2 size-4" /> Completion evidence photo
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}

      {!completionQueue.length && (
        <EmptyState icon={CheckCircle2} title="Queue clear" description="No completion submissions waiting for review." />
      )}
    </div>
  );
}
