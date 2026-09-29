"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, MapPin, PackageCheck, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/patterns/metric-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatPartLocation, operationalStatusOptions, parts as allParts } from "@/lib/mock/parts";

export function OperationsView() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [unlocated, setUnlocated] = useState(false);

  const approved = useMemo(() => allParts.filter((p) => p.status === "approved"), []);

  const stats = useMemo(
    () => ({
      available: approved.filter((p) => p.operationalStatus === "AVAILABLE").length,
      unlocated: approved.filter((p) => !p.zone && !p.rack && !p.shelf && !p.bin).length,
      reserved: approved.filter((p) => p.operationalStatus === "RESERVED").length,
      damaged: approved.filter((p) => p.operationalStatus === "DAMAGED" || p.operationalStatus === "MISSING").length,
    }),
    [approved]
  );

  const results = useMemo(() => {
    let list = approved;
    if (q) {
      const query = q.toLowerCase();
      list = list.filter((p) =>
        [p.stockSku, p.draft.partNumber, p.draft.partName, p.draft.sourceVin, p.draft.sourceLot, p.draft.fitment, p.draft.location]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(query))
      );
    }
    if (status) list = list.filter((p) => p.operationalStatus === status);
    if (unlocated) list = list.filter((p) => !p.zone && !p.rack && !p.shelf && !p.bin);
    return list;
  }, [approved, q, status, unlocated]);

  const recentMovements = useMemo(
    () =>
      approved
        .flatMap((p) => p.history.map((h) => ({ ...h, partId: p.id, stockSku: p.stockSku, partName: p.draft.partName })))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 10),
    [approved]
  );

  function setFilter(nextStatus = "", nextUnlocated = false) {
    setStatus(nextStatus);
    setUnlocated(nextUnlocated);
  }

  function openPart(id: string) {
    router.push(`/parts?open=${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg bg-brand p-5 text-brand-foreground">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Warehouse Control</p>
          <h2 className="mt-1 text-xl font-semibold">Parts Operations</h2>
          <p className="mt-1 text-sm text-brand-foreground/70">Find, locate, move and track every approved part.</p>
        </div>
        <Boxes className="hidden size-12 text-accent-gold/60 sm:block" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={PackageCheck} label="Available parts" value={stats.available} onClick={() => setFilter("AVAILABLE")} active={status === "AVAILABLE"} />
        <MetricCard icon={MapPin} label="Without location" value={stats.unlocated} onClick={() => setFilter("", true)} active={unlocated} />
        <MetricCard icon={ShieldAlert} label="Reserved" value={stats.reserved} onClick={() => setFilter("RESERVED")} active={status === "RESERVED"} />
        <MetricCard icon={AlertTriangle} label="Damaged / Missing" value={stats.damaged} onClick={() => setFilter("DAMAGED")} active={status === "DAMAGED"} />
      </div>

      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="SKU, OEM, part, VIN, Lot, vehicle, fitment or location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={!status && !unlocated ? "default" : "outline"} onClick={() => setFilter()}>
            All
          </Button>
          {operationalStatusOptions.map((x) => (
            <Button key={x} size="sm" variant={status === x ? "default" : "outline"} onClick={() => setFilter(x)}>
              {x}
            </Button>
          ))}
          <Button size="sm" variant={unlocated ? "default" : "outline"} onClick={() => setFilter("", true)}>
            NO LOCATION
          </Button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold">Approved Parts</h3>
          <p className="text-xs text-muted-foreground">{results.length} result(s)</p>
        </div>
        {results.length ? (
          <div className="divide-y divide-border">
            {results.map((p) => (
              <button key={p.id} onClick={() => openPart(p.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-accent/30">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">Photo</div>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{p.draft.partName || p.draft.title}</b>
                  <small className="text-xs text-muted-foreground">Source vehicle not linked</small>
                </span>
                <span className="hidden min-w-0 flex-1 sm:block">
                  <b className="block truncate text-sm">{p.stockSku || "Assigning SKU…"}</b>
                  <small className="text-xs text-muted-foreground">OEM {p.draft.partNumber || "not recorded"}</small>
                </span>
                <span className="hidden min-w-0 flex-1 md:block">
                  <b className="block truncate text-sm">{formatPartLocation(p)}</b>
                  <small className="text-xs text-muted-foreground">
                    {p.operationalStatus} · Qty {p.quantity}
                  </small>
                </span>
                <StatusBadge>{p.operationalStatus}</StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState icon={Search} title="No approved parts match this search." />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold">Recent Movements</h3>
          <p className="text-xs text-muted-foreground">Append-only warehouse history</p>
        </div>
        {recentMovements.length ? (
          <div className="divide-y divide-border">
            {recentMovements.map((item) => (
              <button
                key={item.id}
                onClick={() => openPart(item.partId)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <b className="text-sm">
                  {item.stockSku} · {item.partName}
                </b>
                <span className="text-xs text-muted-foreground">
                  {item.previousLocation || "Unassigned"} → {item.newLocation || "Unassigned"}
                </span>
                <small className="text-xs text-muted-foreground">
                  {item.userName} · {new Date(item.createdAt).toLocaleString()}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState icon={MapPin} title="No movements recorded yet." />
          </div>
        )}
      </section>
    </div>
  );
}
