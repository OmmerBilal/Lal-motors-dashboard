"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { fetchPosThumbnailUrls } from "@/lib/data/sales";
import { OPERATIONAL_LABEL, type WarehousePart } from "@/lib/data/warehouse";
import { useSetWarehouseLocation, useWarehouseList, useWarehousePart, useWarehouseSearch, useWarehouseSummary } from "@/lib/query/warehouse";

type Tab = "pending" | "stored" | "search";
const TABS: { id: Tab; label: string }[] = [
  { id: "pending", label: "Pending Putaway" },
  { id: "stored", label: "Stored Inventory" },
  { id: "search", label: "Search Inventory" },
];

/**
 * Warehouse Employee App: a simple inventory workspace. The only action is putting a part away / changing its
 * warehouse location. Parts are the same Parts Inventory records; nothing here creates a part, a price or a sale.
 * `preview` marks the owner's review of this same screen.
 */
export function WarehouseApp({ preview = false }: { preview?: boolean }) {
  const [tab, setTab] = useState<Tab>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const summary = useWarehouseSummary();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-8">
      {preview && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning-foreground">
          Warehouse Employee App Preview · owner review of the employee screen
        </p>
      )}
      <header className="flex items-center gap-3 rounded-lg bg-brand p-4 text-brand-foreground sm:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white/10">
          <Warehouse className="size-5" />
        </span>
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Warehouse</p>
          <h2 className="text-lg font-semibold">Warehouse Employee App</h2>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Pending Putaway" value={summary.data?.pending} />
        <SummaryCard label="Stored" value={summary.data?.stored} />
      </div>

      <div role="tablist" aria-label="Warehouse views" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pending" && <PendingPutaway onOpen={setOpenId} />}
      {tab === "stored" && <StoredInventory onOpen={setOpenId} />}
      {tab === "search" && <SearchInventory onOpen={setOpenId} />}

      <PartDialog partId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function PendingPutaway({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useWarehouseList("pending");
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <ListShell loading={list.isPending} error={list.error?.message} empty={rows.length === 0} emptyTitle="Nothing waiting for a location.">
      <PartCards rows={rows} onOpen={onOpen} action="Put Away / Assign Location" />
      {list.hasNextPage && <LoadMore busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />}
    </ListShell>
  );
}

function StoredInventory({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useWarehouseList("stored");
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <ListShell loading={list.isPending} error={list.error?.message} empty={rows.length === 0} emptyTitle="No parts have a location yet.">
      <PartCards rows={rows} onOpen={onOpen} action="View / Change Location" />
      {list.hasNextPage && <LoadMore busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />}
    </ListShell>
  );
}

function SearchInventory({ onOpen }: { onOpen: (id: string) => void }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);
  const results = useWarehouseSearch(term);
  const rows = term.length >= 2 ? results.data ?? [] : [];
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-11 pl-8 text-sm" placeholder="Part name, SKU or OEM / interchange number" aria-label="Search inventory" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className="text-[11px] text-muted-foreground">Type at least 2 characters. Up to 25 results.</p>
      <ListShell loading={term.length >= 2 && results.isPending} error={term.length >= 2 ? results.error?.message : undefined} empty={term.length >= 2 && rows.length === 0 && !results.isPending} emptyTitle="No inventory part matches this search.">
        <PartCards rows={rows} onOpen={onOpen} action="View / Change Location" />
      </ListShell>
    </div>
  );
}

function ListShell({ loading, error, empty, emptyTitle, children }: { loading: boolean; error?: string; empty: boolean; emptyTitle: string; children: ReactNode }) {
  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (empty) return <EmptyState icon={Package} title={emptyTitle} />;
  return <div className="space-y-3">{children}</div>;
}

function LoadMore({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" className="w-full" disabled={busy} onClick={onClick}>
      {busy ? "Loading…" : "Load more"}
    </Button>
  );
}

function PartCards({ rows, onOpen, action }: { rows: WarehousePart[]; onOpen: (id: string) => void; action: string }) {
  const thumbs = useThumbs(rows.map((r) => r.id));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} data-testid="warehouse-row" data-sku={r.stock_sku ?? ""} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <Thumb url={thumbs.data?.[r.id] ?? null} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold break-words">{r.part_name}</p>
            <p className="text-xs text-muted-foreground break-all">SKU {r.stock_sku ?? "—"}{r.part_number ? ` · OEM ${r.part_number}` : ""}</p>
            <p className="text-xs text-muted-foreground tabular-nums">Quantity {r.quantity} · {r.location ? <b className="text-foreground">{r.location}</b> : "No location yet"}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <StatusBadge tone={r.operational_status === "AVAILABLE" ? "success" : "neutral"}>{OPERATIONAL_LABEL[r.operational_status] ?? r.operational_status}</StatusBadge>
            <Button size="sm" className="h-10 w-full sm:w-auto" onClick={() => onOpen(r.id)}>{action}</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PartDialog({ partId, onClose }: { partId: string | null; onClose: () => void }) {
  const detail = useWarehousePart(partId);
  const save = useSetWarehouseLocation();
  const [draft, setDraft] = useState<{ id: string | null; value: string }>({ id: null, value: "" });
  const d = detail.data;
  const current = d?.part.location ?? "";
  // The draft starts from the server's location each time a part is opened.
  const value = draft.id === partId ? draft.value : current;
  const thumbs = useThumbs(d ? [d.part.id] : []);
  const trimmed = value.trim();
  const canSave = !!d?.part.can_place && trimmed.length >= 1 && trimmed !== current && !save.isPending;

  return (
    <Dialog open={!!partId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Part</DialogTitle>
        </DialogHeader>
        {detail.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {detail.isError && <p className="text-sm text-destructive">{detail.error.message}</p>}
        {d && (
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Thumb url={thumbs.data?.[d.part.id] ?? null} size="size-20" />
              <div className="min-w-0 space-y-1">
                <p className="font-semibold break-words">{d.part.part_name}</p>
                <p className="text-xs text-muted-foreground break-all">SKU {d.part.stock_sku ?? "—"}</p>
                {d.part.part_number && <p className="text-xs text-muted-foreground break-all">OEM / interchange {d.part.part_number}</p>}
                <p className="text-xs text-muted-foreground">Quantity {d.part.quantity} · Status {OPERATIONAL_LABEL[d.part.operational_status] ?? d.part.operational_status}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Donor VIN</dt>
              <dd className="break-all">{d.part.source_vin ?? "—"}</dd>
              <dt className="text-muted-foreground">Donor lot</dt>
              <dd className="break-all">{d.part.source_lot ?? "—"}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd>{d.part.inventory_source === "manual" ? "Manual inventory part" : "Dismantled part"}</dd>
            </dl>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <label htmlFor="warehouse-location" className="text-sm font-semibold">Warehouse location</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="warehouse-location"
                  className="h-11"
                  placeholder="e.g. A-12 or Rack B / Shelf 2"
                  maxLength={80}
                  value={value}
                  disabled={!d.part.can_place}
                  onChange={(e) => setDraft({ id: partId, value: e.target.value })}
                />
                <Button
                  className="h-11 sm:w-auto"
                  disabled={!canSave}
                  onClick={() =>
                    save.mutate(
                      { partId: d.part.id, location: trimmed },
                      {
                        onSuccess: () => {
                          setDraft({ id: null, value: "" });
                          toast.success(current ? "Location changed." : "Location assigned.");
                        },
                        onError: (e) => toast.error(e.message),
                      }
                    )
                  }
                >
                  {save.isPending ? "Saving…" : current ? "Save location" : "Assign location"}
                </Button>
              </div>
              {!d.part.can_place && <p className="text-xs text-muted-foreground">Only an approved inventory part can be placed.</p>}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">History</p>
              {d.history.length === 0 && <p className="text-xs text-muted-foreground">No history yet.</p>}
              <ul className="space-y-1">
                {d.history.map((h, i) => (
                  <li key={i} className="rounded-md border border-border p-2 text-xs">
                    <span className="font-medium">{h.action.replaceAll("_", " ").toLowerCase()}</span>
                    {h.action === "LOCATION_CHANGE" && <span> · {h.previous_location ?? "none"} → {h.new_location ?? "none"}</span>}
                    <span className="text-muted-foreground"> · {h.actor_name} ({h.actor_role}) · {new Date(h.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useThumbs(partIds: string[]) {
  const key = [...new Set(partIds)].sort().join(",");
  return useQuery({
    queryKey: ["warehouse", "thumbs", key],
    queryFn: () => fetchPosThumbnailUrls(key.split(",").filter(Boolean)),
    enabled: key.length > 0,
    staleTime: 60_000,
  });
}

function Thumb({ url, size = "size-14" }: { url: string | null; size?: string }) {
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL, thumbnail variant only
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Package className="size-5" aria-label="No photo" />
      )}
    </div>
  );
}
