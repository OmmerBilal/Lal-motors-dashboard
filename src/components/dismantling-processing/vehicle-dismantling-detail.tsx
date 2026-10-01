"use client";

import { useState } from "react";
import { ArrowLeft, CarFront, Image as ImageIcon, History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDismantlingProcessingData } from "@/components/dismantling-processing/use-dismantling-data";
import { suggestedOem } from "@/lib/mock/dismantling-processing";
import { PhotoGalleryDialog, type PhotoTile } from "@/components/dismantling-processing/photo-gallery-dialog";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value ?? "—"}</span>
    </div>
  );
}

export function VehicleDismantlingDetail({ vehicleId, onBack }: { vehicleId: string; onBack: () => void }) {
  const { getVehicle, vehicleEvents, reviewCandidates } = useDismantlingProcessingData();
  const [galleryOpen, setGalleryOpen] = useState(false);

  const vehicle = getVehicle(vehicleId);
  const history = vehicleEvents(vehicleId);
  const start = history.find((e) => e.action === "START");
  const finish = history.find((e) => e.action === "STATUS" && e.status === "Dismantled");
  const parts = history.filter((e) => e.action === "PART_REMOVED");
  const candidatesForVehicle = reviewCandidates.filter((c) => c.vehicle.id === vehicleId);
  const candidatePartIds = new Set(candidatesForVehicle.map((c) => c.event.partId));

  const tiles: PhotoTile[] = [
    { id: "vehicle-photo", label: "Vehicle Photo", kind: "vehicle" },
    ...parts.map((p, i) => ({ id: p.id, label: p.partType || `Part Photo ${i + 1}`, kind: "part" as const })),
  ];

  if (!vehicle) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <p className="text-sm text-muted-foreground">Vehicle not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-4">
              <div className="flex aspect-[4/3] w-32 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
                <CarFront className="size-8" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </h3>
                <div className="mt-1">
                  <Field label="VIN" value={vehicle.vin} />
                  <Field label="Stock #" value={vehicle.stockNumber} />
                  <Field label="Lot #" value={vehicle.lotNumber} />
                  <Field label="Engine" value={vehicle.engine} />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dismantling</h4>
            <Field label="Dismantled By" value={vehicle.assignedName} />
            <Field label="Started" value={start ? new Date(start.createdAt).toLocaleString() : "—"} />
            <Field label="Finished" value={finish ? new Date(finish.createdAt).toLocaleString() : "—"} />
            <Field label="Status" value={<StatusBadge>{vehicle.status}</StatusBadge>} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Photos</h4>
              <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
                <ImageIcon className="size-4" /> View Photos
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Original vehicle photo and {parts.length} part photo(s) captured by {vehicle.assignedName || "the employee"}.
            </p>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-4">
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Processing</h4>
            {!parts.length && <p className="text-sm text-muted-foreground">No parts captured.</p>}
            <div className="space-y-2">
              {parts.map((p) => {
                const needsReview = p.partId ? candidatePartIds.has(p.partId) : false;
                const kind = candidatesForVehicle.find((c) => c.event.partId === p.partId)?.kind;
                const tone = needsReview ? (kind === "possible_duplicate" ? "warning" : "warning") : p.disposition === "IN INVENTORY" ? "success" : "neutral";
                const label = needsReview
                  ? kind === "possible_duplicate"
                    ? "Needs Verification"
                    : "AI Suggested"
                  : p.disposition === "IN INVENTORY"
                    ? "Manager Approved"
                    : "Reviewed";
                return (
                  <div key={p.id} className="rounded-md border border-border bg-background p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <b>{p.partType}</b>
                      <StatusBadge tone={tone}>{label}</StatusBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Suggested OEM {p.partId ? suggestedOem(p.partId) : "—"} · {new Date(p.createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <HistoryIcon className="size-4" /> History
            </h4>
            <div className="space-y-1.5">
              {history.map((e) => (
                <div key={e.id} className="rounded-md border border-border bg-background p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <b>{e.action.replaceAll("_", " ")}</b>
                    <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {e.actorName}
                    {e.note ? ` — ${e.note}` : ""}
                    {e.partType ? ` — ${e.partType}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <PhotoGalleryDialog
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        title={`${vehicle.year} ${vehicle.make} ${vehicle.model} — Photos`}
        tiles={tiles}
      />
    </div>
  );
}
