"use client";

import { Package, Plus } from "lucide-react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usd } from "@/lib/mock/sales";
import type { PartSearchResult } from "@/lib/mock/pos";

export function PartResultCard({ result, onSelect, onAdd, selected }: { result: PartSearchResult; onSelect: () => void; onAdd: () => void; selected?: boolean }) {
  const { part, donor, donorLabel } = result;
  const available = part.operationalStatus === "AVAILABLE" && part.quantity > 0;

  return (
    <div className={`flex items-center gap-3 rounded-md border p-2.5 ${selected ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
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
        className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
      >
        <Plus className="size-3.5" /> Add
      </button>
    </div>
  );
}
