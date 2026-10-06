"use client";

import { useEffect, useRef, useState } from "react";
import { PackageSearch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";
import { StepHeader } from "@/components/sales/pos/step-header";
import { PartResultCard } from "@/components/sales/pos/part-result-card";
import { usePosThumbnails, useSellableParts } from "@/lib/query/sales";
import type { SellablePart } from "@/lib/data/sales";

/**
 * Parts are shown only after a search. Nothing is listed before the desk types at least two characters, so the
 * whole inventory is never on screen. After Add the search keeps its text and the field keeps focus for the next part.
 */
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Short debounce so typing does not send a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const searching = debounced.length >= 2;
  const search = useSellableParts(debounced);
  const results = searching ? search.data ?? [] : [];
  const thumbs = usePosThumbnails(results.map((r) => r.id));

  function addAndKeepSearching(part: SellablePart) {
    onAddPart(part);
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader step={2} icon={PackageSearch} title="Find Parts" />

      <div className="relative mb-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="h-10 pl-8 text-sm"
          placeholder="Part name, SKU or OEM number"
          aria-label="Search parts"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <p className="mb-2.5 text-[11px] text-muted-foreground">Type at least 2 characters. Out of Stock parts show but cannot be added.</p>

      <div className="max-h-80 flex-1 space-y-2 overflow-y-auto">
        {!searching && <p className="py-6 text-center text-xs text-muted-foreground">Search for a part to add it to the sale.</p>}
        {searching && search.isPending && <p className="py-4 text-center text-xs text-muted-foreground">Searching…</p>}
        {searching && search.isError && <p className="py-4 text-center text-xs text-destructive">{search.error.message}</p>}
        {searching && !search.isPending && !search.isError && results.length > 0 &&
          results.map((r) => (
            <PartResultCard
              key={r.id}
              part={r}
              thumbnailUrl={thumbs.data?.[r.id] ?? null}
              selected={selectedPartId === r.id}
              onSelect={() => onSelectPart(r)}
              onAdd={() => addAndKeepSearching(r)}
            />
          ))}
        {searching && !search.isPending && !search.isError && !results.length && <EmptyState icon={Search} title="No sellable parts match this search." />}
      </div>
    </div>
  );
}
