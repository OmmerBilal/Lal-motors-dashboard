"use client";

import { Package, Plus } from "lucide-react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usd } from "@/lib/mock/sales";
import type { PartSearchResult } from "@/lib/mock/pos";

export function PartResultCard({ result, onSelect, onAdd, selected }: { result: PartSearchResult; onSelect: () => void; onAdd: () => void; selected?: boolean }) {
  const { part, donor, donorLabel } = result;
  const available = part.operationalStatus === "AVAILABLE" && part.quantity > 0;

  return (
    <div className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${selected ? "border-primary/50 bg-primary/5 shadow-sm" : "border-border hover:border-primary/25"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className={`flex size-12 shrink-0 items-center justify-center rounded-md ${available ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
          <Package className="size-5" />
        </div>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm">{part.draft.partName || part.draft.title}</b>
          <small className="block truncate text-xs text-muted-foreground">{donorLabel}</small>
          <small className="block truncate text-xs text-muted-foreground">
            {part.stockSku} {donor?.vin ? `· VIN ${donor.vin.slice(-6)}` : ""} · {part.draft.location || "Location TBD"}
          </small>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <StatusBadge tone={available ? "success" : "neutral"}>{available ? "Available" : part.operationalStatus}</StatusBadge>
          <b className="mt-1 block text-sm">{usd(part.draft.price)}</b>
        </span>
      </button>
      <button
        onClick={onAdd}
        disabled={!available}
        className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:shadow-none"
      >
        <Plus className="size-3.5" /> Add
      </button>
    </div>
  );
}
