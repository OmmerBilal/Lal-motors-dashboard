"use client";

import { Camera, FileText, Package } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { usd } from "@/lib/mock/sales";
import type { PartSearchResult } from "@/lib/mock/pos";

export function LowerInfoArea({ selected }: { selected: PartSearchResult | null }) {
  if (!selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <EmptyState icon={Package} title="Select a part to see its details, donor vehicle and documents." />
      </div>
    );
  }

  const { part, donor } = selected;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Selected Part Details</h4>
        <b className="block text-sm">{part.draft.partName || part.draft.title}</b>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">SKU</span>
          <span>{part.stockSku || "—"}</span>
          <span className="text-muted-foreground">OEM #</span>
          <span>{part.draft.partNumber || "—"}</span>
          <span className="text-muted-foreground">Category</span>
          <span>{part.draft.category || "—"}</span>
          <span className="text-muted-foreground">Condition</span>
          <span>{part.draft.condition || "—"}</span>
          <span className="text-muted-foreground">Location</span>
          <span>{part.draft.location || "—"}</span>
          <span className="text-muted-foreground">Fitment</span>
          <span className="truncate">{part.draft.fitment || "—"}</span>
          <span className="text-muted-foreground">Price</span>
          <b>{usd(part.draft.price)}</b>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Donor Vehicle</h4>
        {donor ? (
          <>
            <b className="block text-sm">
              {donor.year} {donor.make} {donor.model} {donor.trim}
            </b>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">VIN</span>
              <span className="truncate">{donor.vin || "—"}</span>
              <span className="text-muted-foreground">Lot #</span>
              <span>{donor.lotNumber || "—"}</span>
              <span className="text-muted-foreground">Mileage</span>
              <span>{donor.mileage ? Number(donor.mileage).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground">Status</span>
              <span>{donor.status}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Donor vehicle not linked to this part record.</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Documents &amp; Photos</h4>
        <div className="grid grid-cols-3 gap-2">
          {part.photos.map((p) => (
            <div key={p.id} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted text-muted-foreground">
              {p.type === "final" ? <FileText className="size-4" /> : <Camera className="size-4" />}
              <span className="text-[9px] capitalize">{p.type}</span>
            </div>
          ))}
        </div>
        {!part.photos.length && <p className="text-sm text-muted-foreground">No photos linked yet.</p>}
      </div>
    </div>
  );
}
