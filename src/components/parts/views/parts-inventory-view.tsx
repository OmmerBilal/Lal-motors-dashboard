"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  CheckCircle2,
  Clock,
  PackageSearch,
  ScanLine,
  Search,
  ShoppingBag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usePartsData } from "@/components/parts/parts-data-context";
import { partStageLabels, type PartRecord, type PartStage } from "@/lib/mock/parts";
import { useSession } from "@/lib/session";
import { ProcessPartWorkspace } from "@/components/parts/views/process-part-workspace";

type CardFilter = "all" | PartStage | "sold";

const PAGE_SIZE = 8;

function partDisplayName(p: PartRecord): string {
  return p.draft.partName || p.draft.title || "Unidentified part";
}

function donorLabel(p: PartRecord): string {
  if (p.donor) return `${p.donor.year} ${p.donor.make} ${p.donor.model}`.trim();
  if (p.draft.sourceVin) return `VIN ${p.draft.sourceVin}`;
  return "—";
}

function donorYear(p: PartRecord): string {
  return p.donor?.year || "—";
}

function isSold(p: PartRecord): boolean {
  return p.operationalStatus === "SOLD";
}

export function PartsInventoryView({ manager, initialPartId }: { manager: boolean; initialPartId?: string | null }) {
  const { parts, setStage } = usePartsData();
  const { user } = useSession();
  const [filter, setFilter] = useState<CardFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialPartId ?? null);

  const counts = useMemo(() => {
    const needsProcessing = parts.filter((p) => p.stage === "needs_processing").length;
    const inProcessing = parts.filter((p) => p.stage === "in_processing").length;
    const readyForSale = parts.filter((p) => p.stage === "ready_for_sale" && !isSold(p)).length;
    const sold = parts.filter(isSold).length;
    return { needsProcessing, inProcessing, readyForSale, sold };
  }, [parts]);

  const filtered = useMemo(() => {
    let list = parts;
    if (filter === "needs_processing") list = list.filter((p) => p.stage === "needs_processing");
    else if (filter === "in_processing") list = list.filter((p) => p.stage === "in_processing");
    else if (filter === "ready_for_sale") list = list.filter((p) => p.stage === "ready_for_sale" && !isSold(p));
    else if (filter === "sold") list = list.filter(isSold);
    else if (filter === "not_sellable") list = list.filter((p) => p.stage === "not_sellable");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) =>
        [p.partCode, p.stockSku, p.draft.partName, p.draft.title, p.draft.sourceVin, p.donor?.vin, donorLabel(p)]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q))
      );
    }

    const sorted = [...list].sort((a, b) => {
      if (sort === "name") return partDisplayName(a).localeCompare(partDisplayName(b));
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "newest" ? -diff : diff;
    });
    return sorted;
  }, [parts, filter, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function changeFilter(next: CardFilter) {
    setFilter(next);
    setPage(1);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runDemoScan() {
    setScanning(true);
    window.setTimeout(() => {
      setScanning(false);
      toast.info("Barcode scanner — Demo / Not Connected", {
        description: "Hardware scanning isn't wired up yet. Type a SKU, part code or VIN above to search instead.",
      });
    }, 500);
  }

  function startProcessingSelected() {
    const ids = [...selected].filter((id) => parts.find((p) => p.id === id)?.stage === "needs_processing");
    ids.forEach((id) => setStage(id, "in_processing", user.name, "Moved to In Processing"));
    if (ids.length) toast.success(`${ids.length} part(s) moved to In Processing`);
    setSelected(new Set());
  }

  const cards: { key: CardFilter; label: string; value: number; tone: string; icon: typeof Clock }[] = [
    { key: "needs_processing", label: "Needs Processing", value: counts.needsProcessing, tone: "border-warning/40 bg-warning/10 text-warning-foreground", icon: Clock },
    { key: "in_processing", label: "In Processing", value: counts.inProcessing, tone: "border-primary/40 bg-primary/10 text-primary", icon: PackageSearch },
    { key: "ready_for_sale", label: "Ready for Sale", value: counts.readyForSale, tone: "border-success/40 bg-success/10 text-success", icon: CheckCircle2 },
    { key: "sold", label: "Sold", value: counts.sold, tone: "border-border bg-muted text-muted-foreground", icon: ShoppingBag },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by SKU, part name, donor vehicle or barcode…"
            className="pl-9"
          />
        </div>
        <button
          onClick={runDemoScan}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-accent-gold/40 bg-accent-gold/10 px-4 text-sm font-semibold text-accent-gold-foreground hover:bg-accent-gold/20"
        >
          <ScanLine className="size-4" /> {scanning ? "Scanning…" : "Scan Barcode"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => {
          const Icon = c.icon;
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              onClick={() => changeFilter(active ? "all" : c.key)}
              className={`rounded-lg border p-3 text-left transition-colors ${c.tone} ${active ? "ring-2 ring-offset-1 ring-current" : "hover:brightness-95"}`}
            >
              <Icon className="size-5" />
              <p className="mt-2 text-2xl font-bold leading-none">{c.value}</p>
              <p className="mt-1 text-xs font-semibold">{c.label}</p>
            </button>
          );
        })}
        <button
          onClick={runDemoScan}
          className="rounded-lg border border-accent-gold/40 bg-accent-gold/10 p-3 text-left text-accent-gold-foreground transition-colors hover:bg-accent-gold/20"
        >
          <Boxes className="size-5" />
          <p className="mt-2 text-2xl font-bold leading-none">Scan</p>
          <p className="mt-1 text-xs font-semibold">Search / Scan</p>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filtered.length} part{filtered.length === 1 ? "" : "s"}
          {filter !== "all" ? ` · ${partStageLabels[filter as PartStage] ?? "Sold"}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {selected.size > 0 && filter === "needs_processing" && (
            <Button size="sm" variant="outline" onClick={startProcessingSelected}>
              Start Processing ({selected.size})
            </Button>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Part name</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start">
        <div className={selectedId ? "hidden lg:block" : ""}>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {pageItems.length ? (
              <div className="divide-y divide-border">
                {pageItems.map((p) => (
                  <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 ${selectedId === p.id ? "bg-accent/40" : ""}`}>
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} aria-label="Select part" />
                    <button onClick={() => setSelectedId(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
                        {p.partCode.split("-")[0]}
                      </div>
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-sm">{partDisplayName(p)}</b>
                        <small className="block truncate text-xs text-muted-foreground">{p.partCode}</small>
                      </span>
                      <span className="hidden min-w-0 flex-1 md:block">
                        <span className="block truncate text-sm">{donorLabel(p)}</span>
                        <small className="text-xs text-muted-foreground">{donorYear(p)}</small>
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:block">{new Date(p.createdAt).toLocaleDateString()}</span>
                      <StatusBadge tone={isSold(p) ? "neutral" : p.stage === "ready_for_sale" ? "success" : p.stage === "not_sellable" ? "danger" : p.stage === "in_processing" ? "info" : "warning"}>
                        {isSold(p) ? "Sold" : partStageLabels[p.stage]}
                      </StatusBadge>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <EmptyState icon={PackageSearch} title="No parts match this view" description="Try a different status card or clear the search." />
              </div>
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((n) => n + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>

        <div className={selectedId ? "" : "hidden lg:block"}>
          {selectedId ? (
            <ProcessPartWorkspace key={selectedId} partId={selectedId} manager={manager} onBack={() => setSelectedId(null)} />
          ) : (
            <EmptyState icon={PackageSearch} title="Select a part to begin processing" description="Choose a part from the queue on the left to view and process its full record." />
          )}
        </div>
      </div>
    </div>
  );
}
