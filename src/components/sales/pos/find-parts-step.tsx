"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { PartResultCard } from "@/components/sales/pos/part-result-card";
import { approvedPartResults, emptyPartFilters, filterPartResults, mockAiPartSearch, partFilterOptions, type PartSearchResult } from "@/lib/mock/pos";

export function FindPartsStep({
  selectedPartId,
  onSelectPart,
  onAddPart,
}: {
  selectedPartId: string | null;
  onSelectPart: (result: PartSearchResult) => void;
  onAddPart: (result: PartSearchResult) => void;
}) {
  const [tab, setTab] = useState<"inventory" | "ai">("inventory");
  const [filters, setFilters] = useState(emptyPartFilters);
  const [showMore, setShowMore] = useState(false);
  const [aiResults, setAiResults] = useState<PartSearchResult[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const allResults = useMemo(() => approvedPartResults(), []);
  const options = useMemo(() => partFilterOptions(allResults), [allResults]);
  const filtered = useMemo(() => filterPartResults(allResults, filters), [allResults, filters]);

  function runAiSearch(fileName: string) {
    setAiBusy(true);
    toast.info(`Analyzing ${fileName}…`);
    window.setTimeout(() => {
      setAiResults(mockAiPartSearch());
      setAiBusy(false);
    }, 500);
  }

  const results = tab === "inventory" ? filtered : aiResults;

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">2. Find Parts</h3>

      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-md bg-muted p-1">
        <button onClick={() => setTab("inventory")} className={`rounded px-2 py-1.5 text-xs font-semibold ${tab === "inventory" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
          Inventory Search
        </button>
        <button onClick={() => setTab("ai")} className={`rounded px-2 py-1.5 text-xs font-semibold ${tab === "ai" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
          AI Search / Photo
        </button>
      </div>

      {tab === "inventory" ? (
        <>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-sm"
              placeholder="SKU, OEM, part, VIN, Lot, fitment"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Select value={filters.year || "any"} onValueChange={(v) => setFilters({ ...filters, year: v === "any" ? "" : v || "" })}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Year">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any year</SelectItem>
                {options.years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.make || "any"} onValueChange={(v) => setFilters({ ...filters, make: v === "any" ? "" : v || "" })}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Make">
                <SelectValue placeholder="Make" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any make</SelectItem>
                {options.makes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.model || "any"} onValueChange={(v) => setFilters({ ...filters, model: v === "any" ? "" : v || "" })}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Model">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any model</SelectItem>
                {options.models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowMore((v) => !v)}>
              <SlidersHorizontal className="size-3.5" /> More Filters
            </Button>
          </div>
          {showMore && (
            <div className="mb-2">
              <Select value={filters.category || "any"} onValueChange={(v) => setFilters({ ...filters, category: v === "any" ? "" : v || "" })}>
                <SelectTrigger className="h-8 w-full text-xs" aria-label="Category">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any category</SelectItem>
                  {options.categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      ) : (
        <div className="mb-3 flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-4 text-center">
          <Camera className="size-6 text-primary" />
          <p className="text-xs text-muted-foreground">Upload a part photo and AI will suggest matching inventory.</p>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            Upload Photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && runAiSearch(e.target.files[0].name)} />
          </label>
          {aiBusy && <p className="text-xs text-muted-foreground">Analyzing…</p>}
        </div>
      )}

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {results?.length ? (
          results.map((r) => (
            <PartResultCard key={r.part.id} result={r} selected={selectedPartId === r.part.id} onSelect={() => onSelectPart(r)} onAdd={() => onAddPart(r)} />
          ))
        ) : (
          <EmptyState icon={Search} title={tab === "ai" ? "Upload a photo to search." : "No parts match this search."} />
        )}
      </div>
    </div>
  );
}
