"use client";

import { toast } from "sonner";
import { Minus, Package, Plus } from "lucide-react";
import { usePartThumbnails, usePlannedItems, useLoaderMutations } from "@/lib/query/containers";
import type { PlannedItem } from "@/lib/data/containers";

/**
 * Planned parts for the loader. The loader confirms what physically went in: 0 <= loaded <= planned.
 * Nothing here is a price, and nothing here moves stock: stock changes once, when loading is finished.
 */
export function LoaderPlannedParts({ containerId, finished }: { containerId: string; finished: boolean }) {
  const planned = usePlannedItems(containerId);
  const items = planned.data?.items ?? [];
  const thumbs = usePartThumbnails(items.map((i) => i.part_id));

  if (planned.isPending) return <p className="text-sm text-muted-foreground">Loading planned parts…</p>;
  if (planned.isError) return <p className="text-sm text-destructive">{planned.error.message}</p>;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{finished ? "No parts were loaded into this container." : "Management has not planned any parts for this container yet."}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <LoadedRow key={i.id} item={i} thumbUrl={thumbs.data?.[i.part_id] ?? null} locked={finished || i.status !== "planned"} />
      ))}
    </ul>
  );
}

function LoadedRow({ item, thumbUrl, locked }: { item: PlannedItem; thumbUrl: string | null; locked: boolean }) {
  const { setLoaded } = useLoaderMutations();
  const set = (qty: number) =>
    setLoaded.mutate({ itemId: item.id, loadedQty: qty }, { onError: (e) => toast.error(e.message) });

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5" data-testid="loader-planned-row" data-sku={item.stock_sku ?? ""}>
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed private URL, thumbnail variant only
          <img src={thumbUrl} alt={item.part_name} loading="lazy" className="size-full object-cover" />
        ) : (
          <Package className="size-5" aria-label="No photo" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{item.part_name}</p>
        <p className="text-xs text-muted-foreground break-all">SKU {item.stock_sku ?? "—"}</p>
        <p className="text-xs text-muted-foreground tabular-nums">Planned {item.planned_qty}</p>
      </div>
      <div className="flex shrink-0 items-center rounded-md border border-border" role="group" aria-label={`Loaded quantity for ${item.part_name}`}>
        <button
          type="button"
          aria-label="Decrease loaded quantity"
          disabled={locked || setLoaded.isPending || item.loaded_qty <= 0}
          onClick={() => set(item.loaded_qty - 1)}
          className="flex size-10 items-center justify-center transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <span aria-label="Loaded quantity" className="min-w-10 text-center text-base font-semibold tabular-nums">{item.loaded_qty}</span>
        <button
          type="button"
          aria-label="Increase loaded quantity"
          disabled={locked || setLoaded.isPending || item.loaded_qty >= item.planned_qty}
          onClick={() => set(item.loaded_qty + 1)}
          className="flex size-10 items-center justify-center transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </li>
  );
}

/** What is inside the container, before Mark Loading Finished. Totals only: no prices, no stock. */
export function LoaderFinalSummary({ containerId, evidence }: { containerId: string; evidence: { number: boolean; loadingPhotos: number; finalList: boolean } }) {
  const planned = usePlannedItems(containerId);
  const items = planned.data?.items ?? [];
  const loadedLines = items.filter((i) => i.loaded_qty > 0).length;
  const loadedTotal = items.reduce((n, i) => n + i.loaded_qty, 0);
  const missing = items.reduce((n, i) => n + Math.max(0, i.planned_qty - i.loaded_qty), 0);

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" aria-label="Final summary">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Final summary</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Planned lines</dt>
        <dd className="tabular-nums">{items.length}</dd>
        <dt className="text-muted-foreground">Loaded lines</dt>
        <dd className="tabular-nums">{loadedLines}</dd>
        <dt className="text-muted-foreground">Total loaded</dt>
        <dd className="tabular-nums font-semibold">{loadedTotal}</dd>
        <dt className="text-muted-foreground">Not loaded (released)</dt>
        <dd className="tabular-nums">{missing}</dd>
        <dt className="text-muted-foreground">Evidence</dt>
        <dd>
          {evidence.number ? "Number ✓" : "Number missing"} · {evidence.loadingPhotos} loading photo(s) · {evidence.finalList ? "Final list ✓" : "Final list missing"}
        </dd>
      </dl>
    </section>
  );
}
