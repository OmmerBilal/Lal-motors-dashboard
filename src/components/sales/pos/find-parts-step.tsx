"use client";

import { useEffect, useState } from "react";
import { PackageSearch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";
import { StepHeader } from "@/components/sales/pos/step-header";
import { PartResultCard } from "@/components/sales/pos/part-result-card";
import { usePosThumbnails, useSellableParts } from "@/lib/query/sales";
import type { SellablePart } from "@/lib/data/sales";

export function FindPartsStep({
  selectedPartId,
  onSelectPart,
  onAddPart,
}: {
  selectedPartId: string | null;
  onSelectPart: (part: SellablePart) => void;
  onAddPart: (part: SellablePart) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  // Short debounce so typing does not send a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const search = useSellableParts(debounced);
  const results = search.data ?? [];
  const thumbs = usePosThumbnails(results.map((r) => r.id));

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader step={2} icon={PackageSearch} title="Find Parts" />

      <div className="relative mb-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 pl-8 text-sm" placeholder="Part name, SKU or OEM number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="mb-2.5 text-[11px] text-muted-foreground">Only sellable parts are listed. Parts with no stock stay visible as Out of Stock.</p>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {search.isPending && <p className="py-4 text-center text-xs text-muted-foreground">Searching…</p>}
        {search.isError && <p className="py-4 text-center text-xs text-destructive">{search.error.message}</p>}
        {!search.isPending && !search.isError && results.length > 0 &&
          results.map((r) => (
            <PartResultCard key={r.id} part={r} thumbnailUrl={thumbs.data?.[r.id] ?? null} selected={selectedPartId === r.id} onSelect={() => onSelectPart(r)} onAdd={() => onAddPart(r)} />
          ))}
        {!search.isPending && !search.isError && !results.length && <EmptyState icon={Search} title="No sellable parts match this search." />}
      </div>
    </div>
  );
}
