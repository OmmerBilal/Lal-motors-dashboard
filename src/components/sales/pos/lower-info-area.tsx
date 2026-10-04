"use client";

import { Package } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { usd } from "@/lib/mock/sales";
import type { SellablePart } from "@/lib/data/sales";

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

/** Figures from the search row only. Donor vehicle, photos and location live on the part record. */
export function LowerInfoArea({ selected }: { selected: SellablePart | null }) {
  if (!selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <EmptyState icon={Package} title="Select a part to see its sale details." />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
      <PanelHeading icon={Package} title="Selected Part" />
      <b className="block text-sm">{selected.part_name}</b>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:max-w-md">
        <span className="text-muted-foreground">SKU</span>
        <span className="font-medium">{selected.stock_sku || "—"}</span>
        <span className="text-muted-foreground">On hand</span>
        <span className="font-medium">{selected.quantity}</span>
        <span className="text-muted-foreground">Available</span>
        <span className="font-medium">{selected.available}</span>
        <span className="text-muted-foreground">Price</span>
        <b className="text-primary">{usd(selected.price)}</b>
      </div>
    </div>
  );
}
