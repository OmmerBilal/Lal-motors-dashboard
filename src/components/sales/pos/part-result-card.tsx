"use client";

import { Package, Plus } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/patterns/status-badge";
import { usd } from "@/lib/mock/sales";
import type { SellablePart } from "@/lib/data/sales";

export function PartResultCard({
  part,
  thumbnailUrl,
  onSelect,
  onAdd,
  selected,
}: {
  part: SellablePart;
  thumbnailUrl: string | null;
  onSelect: () => void;
  onAdd: () => void;
  selected?: boolean;
}) {
  const outOfStock = part.out_of_stock || part.available <= 0;
  const tone: StatusTone = outOfStock ? "danger" : "success";
  const label = outOfStock ? "Out of Stock" : `In stock · ${part.available}`;
  const iconTone = outOfStock ? "bg-muted text-muted-foreground" : "bg-success/10 text-success";

  return (
    <div
      data-testid="pos-part-card"
      data-part-id={part.id}
      data-sku={part.stock_sku ?? ""}
      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${selected ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border hover:border-primary/25"}`}
    >
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className={`flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border ${selected ? "border-primary/30" : "border-border"} ${iconTone}`}>
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed private URL, thumbnail variant only
            <img src={thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <Package className="size-6" aria-label="No photo" />
          )}
        </div>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm">{part.part_name}</b>
          <small className="block truncate text-xs text-muted-foreground">{part.stock_sku || "No SKU"}</small>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <StatusBadge tone={tone}>{label}</StatusBadge>
          <b className="mt-1 block text-base tabular-nums text-primary">{usd(part.price)}</b>
        </span>
      </button>
      <button
        onClick={onAdd}
        disabled={outOfStock}
        className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 hover:shadow-md disabled:opacity-40 disabled:shadow-none"
      >
        <Plus className="size-4" /> Add
      </button>
    </div>
  );
}
