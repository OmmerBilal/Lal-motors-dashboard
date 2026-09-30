"use client";

import { Camera, CarFront, FileText, Package } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { usd } from "@/lib/mock/sales";
import type { PartSearchResult } from "@/lib/mock/pos";

function PanelHeading({ icon: Icon, title }: { icon: typeof Package; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-border pb-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </span>
      <h4 className="text-xs font-semibold tracking-wide text-foreground uppercase">{title}</h4>
    </div>
  );
}

export function LowerInfoArea({ selected }: { selected: PartSearchResult | null }) {
  if (!selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <EmptyState icon={Package} title="Select a part to see its details, donor vehicle and documents." />
      </div>
    );
  }

  const { part, donor } = selected;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <PanelHeading icon={Package} title="Selected Part Details" />
        <b className="block text-sm">{part.draft.partName || part.draft.title}</b>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">SKU</span>
          <span className="font-medium">{part.stockSku || "—"}</span>
          <span className="text-muted-foreground">OEM #</span>
          <span className="font-medium">{part.draft.partNumber || "—"}</span>
          <span className="text-muted-foreground">Category</span>
          <span className="font-medium">{part.draft.category || "—"}</span>
          <span className="text-muted-foreground">Condition</span>
          <span className="font-medium">{part.draft.condition || "—"}</span>
          <span className="text-muted-foreground">Location</span>
          <span className="font-medium">{part.draft.location || "—"}</span>
          <span className="text-muted-foreground">Fitment</span>
          <span className="truncate font-medium">{part.draft.fitment || "—"}</span>
          <span className="text-muted-foreground">Price</span>
          <b className="text-primary">{usd(part.draft.price)}</b>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <PanelHeading icon={CarFront} title="Donor Vehicle" />
        {donor ? (
          <>
            <b className="block text-sm">
              {donor.year} {donor.make} {donor.model} {donor.trim}
            </b>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">VIN</span>
              <span className="truncate font-medium">{donor.vin || "—"}</span>
              <span className="text-muted-foreground">Lot #</span>
              <span className="font-medium">{donor.lotNumber || "—"}</span>
              <span className="text-muted-foreground">Mileage</span>
              <span className="font-medium">{donor.mileage ? Number(donor.mileage).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{donor.status}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Donor vehicle not linked to this part record.</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <PanelHeading icon={FileText} title="Documents & Photos" />
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
