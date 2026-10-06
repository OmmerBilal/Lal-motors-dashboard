"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Package, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usePartThumbnails, useExportMutations, useInventorySearch, usePlannedItems } from "@/lib/query/containers";
import type { ContainerStatus, PlannedItem, SearchPart } from "@/lib/data/containers";

/**
 * Planned parts for one container, managed by export management. Planning reserves stock (the same availability
 * the Sales desk uses), so a planned unit cannot be sold elsewhere. The server validates every quantity.
 * Once loading has finished this section shows the actual loaded parts for review.
 */
export function PlannedPartsSection({ containerId, status, partsPlanning }: { containerId: string; status: ContainerStatus; partsPlanning: boolean }) {
  const planned = usePlannedItems(containerId);
  const items = planned.data?.items ?? [];
  const loading = status === "loading";
  const thumbs = usePartThumbnails(items.map((i) => i.part_id));

  if (!partsPlanning && items.length === 0) {
    return (
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-semibold">Loaded parts</h4>
        <p className="text-sm text-muted-foreground">No structured loaded-part list recorded for this legacy container.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{loading ? "Planned parts" : "Actual loaded parts"}</h4>
        {planned.data && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Planned {planned.data.planned_total} · Loaded {planned.data.loaded_total}
          </p>
        )}
      </div>

      {loading && <PlanSearch containerId={containerId} />}

      {planned.isPending && <p className="text-sm text-muted-foreground">Loading parts…</p>}
      {planned.isError && <p className="text-sm text-destructive">{planned.error.message}</p>}
      {!planned.isPending && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{loading ? "No parts planned yet. Search the inventory above to plan parts for this container." : "No parts were loaded into this container."}</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((i) => (
            <PlannedRow key={i.id} item={i} thumbUrl={thumbs.data?.[i.part_id] ?? null} canRemove={loading && i.status === "planned"} />
          ))}
        </ul>
      )}
      {!loading && items.length > 0 && <p className="text-xs text-muted-foreground">Released means planned but not loaded; that stock went back to inventory when loading finished.</p>}
    </section>
  );
}

function PlanSearch({ containerId }: { containerId: string }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(t);
  }, [term]);
  const results = useInventorySearch(containerId, debounced);
  const rows: SearchPart[] = debounced.length >= 2 ? results.data ?? [] : [];
  const thumbs = usePartThumbnails(rows.map((r) => r.id));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 pl-8 text-sm"
          placeholder="Search inventory: part name, SKU or OEM number"
          aria-label="Search inventory for this container"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">Type at least 2 characters. Only parts with available stock are listed (up to 20).</p>
      {debounced.length >= 2 && results.isPending && <p className="text-xs text-muted-foreground">Searching…</p>}
      {debounced.length >= 2 && results.isError && <p className="text-xs text-destructive">{results.error.message}</p>}
      {debounced.length >= 2 && !results.isPending && rows.length === 0 && <p className="text-xs text-muted-foreground">No available parts match this search.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <SearchRow key={r.id} part={r} containerId={containerId} thumbUrl={thumbs.data?.[r.id] ?? null} />
        ))}
      </ul>
    </div>
  );
}

function SearchRow({ part, containerId, thumbUrl }: { part: SearchPart; containerId: string; thumbUrl: string | null }) {
  const { planAdd } = useExportMutations();
  const [qty, setQty] = useState("1");
  const n = Number(qty);
  const valid = Number.isInteger(n) && n >= 1 && n <= part.available;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2.5" data-testid="plan-search-result" data-sku={part.stock_sku ?? ""}>
      <Thumb url={thumbUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{part.part_name}</p>
        <p className="text-xs text-muted-foreground break-all">SKU {part.stock_sku ?? "—"}{part.part_number ? ` · OEM ${part.part_number}` : ""}</p>
        <p className="text-xs text-muted-foreground">Available {part.available}{part.location ? ` · ${part.location}` : ""}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input aria-label="Quantity to load" inputMode="numeric" className="h-9 w-20 text-center tabular-nums" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Button
          size="sm"
          disabled={!valid || planAdd.isPending}
          onClick={() =>
            planAdd.mutate(
              { containerId, partId: part.id, quantity: n },
              { onSuccess: () => toast.success(`${part.part_name}: ${n} planned.`), onError: (e) => toast.error(e.message) }
            )
          }
        >
          Add to Container
        </Button>
      </div>
    </li>
  );
}

function PlannedRow({ item, thumbUrl, canRemove }: { item: PlannedItem; thumbUrl: string | null; canRemove: boolean }) {
  const { planRemove } = useExportMutations();
  const closed = item.status === "finalized";
  const unused = item.planned_qty - item.loaded_qty;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2.5" data-testid="planned-row" data-sku={item.stock_sku ?? ""}>
      <Thumb url={thumbUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{item.part_name}</p>
        <p className="text-xs text-muted-foreground break-all">SKU {item.stock_sku ?? "—"}{item.location ? ` · ${item.location}` : ""}{item.inventory_source === "manual" ? " · manual part" : ""}</p>
        {!closed && item.available !== undefined && <p className="text-xs text-muted-foreground">Available now {item.available}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm tabular-nums">
        <span>Planned <b>{item.planned_qty}</b></span>
        <span>Loaded <b>{item.loaded_qty}</b></span>
        {closed && <span className="text-xs text-muted-foreground">Released {item.released_qty ?? unused}</span>}
        <StatusBadge tone={closed ? "success" : "info"}>{closed ? "FINALIZED" : "PLANNED"}</StatusBadge>
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove from plan"
            className="text-destructive hover:bg-destructive/10"
            disabled={planRemove.isPending}
            onClick={() =>
              planRemove.mutate(item.id, { onSuccess: () => toast.success("Removed from the plan. Stock released."), onError: (e) => toast.error(e.message) })
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL, thumbnail variant only
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Package className="size-5" aria-label="No photo" />
      )}
    </div>
  );
}
