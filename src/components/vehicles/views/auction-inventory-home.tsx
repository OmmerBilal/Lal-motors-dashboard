"use client";

import { useMemo, useState } from "react";
import {
  CarFront,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  FileStack,
  FileText,
  MoreHorizontal,
  Package,
  Pencil,
  Search,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  auctionStageInfo,
  closedReasonOptions,
  computeAuctionInventoryStats,
  type AuctionStage,
  type ClosedReason,
  type VehicleRecord,
} from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

const intakeCards: {
  id: IntakeMethod;
  label: string;
  description: string;
  icon: typeof FileText;
  className: string;
  iconClassName: string;
}[] = [
  {
    id: "bulk",
    label: "Bulk Paste",
    description: "Paste multiple vehicles",
    icon: FileStack,
    className: "border-primary/20 bg-primary/6 hover:bg-primary/10",
    iconClassName: "bg-primary/15 text-primary",
  },
  {
    id: "single",
    label: "Single Vehicle Paste",
    description: "Paste one vehicle",
    icon: FileText,
    className: "border-success/25 bg-success/6 hover:bg-success/10",
    iconClassName: "bg-success/15 text-success",
  },
  {
    id: "scan",
    label: "AI Photo / Screenshot Scan",
    description: "Upload or take a picture",
    icon: Camera,
    className: "border-violet-500/25 bg-violet-500/6 hover:bg-violet-500/10",
    iconClassName: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  {
    id: "manual",
    label: "Manual Entry",
    description: "Enter without AI",
    icon: Pencil,
    className: "border-accent-gold/30 bg-accent-gold/8 hover:bg-accent-gold/15",
    iconClassName: "bg-accent-gold/25 text-accent-gold-foreground",
  },
];

const cardTone: Record<string, { card: string; icon: string; value: string }> = {
  blue: { card: "border-primary/20 bg-primary/6", icon: "bg-primary/15 text-primary", value: "text-primary" },
  amber: { card: "border-warning/25 bg-warning/10", icon: "bg-warning/20 text-warning-foreground", value: "text-warning-foreground" },
  green: { card: "border-success/20 bg-success/8", icon: "bg-success/15 text-success", value: "text-success" },
  red: { card: "border-destructive/20 bg-destructive/8", icon: "bg-destructive/15 text-destructive", value: "text-destructive" },
  slate: { card: "border-border bg-muted/40", icon: "bg-muted text-muted-foreground", value: "text-foreground" },
};

const statusCards: { key: AuctionStage | "total"; label: string; sub: string; icon: typeof CarFront; tone: string }[] = [
  { key: "total", label: "Total Vehicles", sub: "All purchased vehicles", icon: CarFront, tone: "blue" },
  { key: "waiting", label: "Waiting Arrival", sub: "Purchased, not picked up", icon: Clock3, tone: "amber" },
  { key: "transit", label: "In Transit", sub: "With transporter", icon: Truck, tone: "blue" },
  { key: "available", label: "Available in Yard", sub: "Arrived at LAL Motors", icon: CarFront, tone: "green" },
  { key: "overdue", label: "Overdue 10+ Days", sub: "Not yet arrived", icon: TriangleAlert, tone: "red" },
  { key: "closed", label: "Closed / Removed", sub: "Sold or scrapped", icon: CheckCircle2, tone: "slate" },
];

const PAGE_SIZE = 6;

export function AuctionInventoryHome({
  onOpenVehicle,
  onStartIntake,
}: {
  onOpenVehicle: (id: string) => void;
  onStartIntake: (method: IntakeMethod) => void;
}) {
  const { vehicles, closeVehicle } = useVehicleData();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<AuctionStage | "all">("all");
  const [auctionFilter, setAuctionFilter] = useState("all");
  const [transporterFilter, setTransporterFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [closeTarget, setCloseTarget] = useState<VehicleRecord | null>(null);
  const [closeReason, setCloseReason] = useState<ClosedReason>("Scrapped");
  const [closeNote, setCloseNote] = useState("");

  const stats = computeAuctionInventoryStats(vehicles);

  const auctionOptions = useMemo(
    () => [...new Set(vehicles.map((v) => v.auctionSource).filter(Boolean))].sort(),
    [vehicles]
  );
  const transporterOptions = useMemo(
    () => [...new Set(vehicles.map((v) => v.carrierName).filter((x): x is string => Boolean(x)))].sort(),
    [vehicles]
  );

  const filtered = useMemo(() => {
    let list = vehicles;
    if (stageFilter !== "all") list = list.filter((v) => auctionStageInfo(v).stage === stageFilter);
    if (auctionFilter !== "all") list = list.filter((v) => v.auctionSource === auctionFilter);
    if (transporterFilter !== "all") list = list.filter((v) => v.carrierName === transporterFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        [v.vin, v.stockNumber, v.lotNumber, v.year, v.make, v.model]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q))
      );
    }
    return list;
  }, [vehicles, stageFilter, auctionFilter, transporterFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allPageSelected = pageRows.length > 0 && pageRows.every((v) => selected.includes(v.id));

  function setStage(stage: AuctionStage | "all") {
    setStageFilter(stage);
    setPage(1);
  }

  function toggleAll() {
    setSelected((s) => (allPageSelected ? s.filter((id) => !pageRows.some((v) => v.id === id)) : [...new Set([...s, ...pageRows.map((v) => v.id)])]));
  }

  function toggleOne(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function exportCsv() {
    const header = [
      "Stock #",
      "Lot #",
      "VIN",
      "Year",
      "Make",
      "Model",
      "Engine",
      "Auction",
      "Purchase Date",
      "Transporter",
      "Arrival Date",
      "Status",
    ];
    const rows = filtered.map((v) => [
      v.stockNumber,
      v.lotNumber,
      v.vin,
      v.year,
      v.make,
      v.model,
      v.engine,
      v.auctionSource,
      v.saleDate,
      v.carrierName || "Not Assigned",
      v.arrivalDate || "",
      auctionStageInfo(v).label,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auction-vehicle-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openClose(v: VehicleRecord) {
    setCloseTarget(v);
    setCloseReason("Scrapped");
    setCloseNote("");
  }

  function submitClose() {
    if (!closeTarget) return;
    closeVehicle(closeTarget.id, closeReason, closeNote || undefined);
    setCloseTarget(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Auction Vehicle Inventory</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage all purchased auction vehicles from intake to arrival in yard.
        </p>
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Add Purchased Vehicles</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {intakeCards.map((c) => (
            <button
              key={c.id}
              onClick={() => onStartIntake(c.id)}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left shadow-xs transition-colors ${c.className}`}
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${c.iconClassName}`}>
                <c.icon className="size-4.5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Vehicle Status Overview</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {statusCards.map((c) => {
            const tone = cardTone[c.tone];
            const value = c.key === "total" ? stats.total : stats[c.key === "waiting" ? "waitingArrival" : c.key === "transit" ? "inTransit" : c.key === "available" ? "availableInYard" : c.key === "overdue" ? "overdue" : "closed"];
            const active = stageFilter === c.key || (c.key === "total" && stageFilter === "all");
            return (
              <button
                key={c.key}
                onClick={() => setStage(c.key === "total" ? "all" : (c.key as AuctionStage))}
                className={`rounded-lg border p-3.5 text-left transition-shadow ${tone.card} ${active ? "ring-2 ring-offset-1 ring-offset-background" : ""}`}
                style={active ? { boxShadow: "none" } : undefined}
              >
                <span className={`flex size-8 items-center justify-center rounded-md ${tone.icon}`}>
                  <c.icon className="size-4" />
                </span>
                <b className={`mt-2 block text-2xl font-bold tabular-nums ${tone.value}`}>{value}</b>
                <span className="block text-xs font-semibold">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground">{c.sub}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Vehicles</h3>
          {selected.length > 0 && <span className="text-xs text-muted-foreground">{selected.length} selected</span>}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8 text-sm"
              placeholder="Search by VIN, Lot #, Stock #, Make, Model…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select value={stageFilter} onValueChange={(v) => setStage((v as AuctionStage | "all") ?? "all")}>
            <SelectTrigger className="h-9 w-40 text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="waiting">Waiting Arrival</SelectItem>
              <SelectItem value="transit">In Transit</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="closed">Closed / Removed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={auctionFilter} onValueChange={(v) => setAuctionFilter(v || "all")}>
            <SelectTrigger className="h-9 w-36 text-xs">
              <SelectValue placeholder="All Auctions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Auctions</SelectItem>
              {auctionOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={transporterFilter} onValueChange={(v) => setTransporterFilter(v || "all")}>
            <SelectTrigger className="h-9 w-40 text-xs">
              <SelectValue placeholder="All Transporters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Transporters</SelectItem>
              {transporterOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={exportCsv}>
            <Download className="size-3.5" /> Export
          </Button>
        </div>

        {pageRows.length ? (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="w-9 p-2.5">
                      <Checkbox checked={allPageSelected} onCheckedChange={toggleAll} aria-label="Select all on page" />
                    </th>
                    <th className="p-2.5">Photo</th>
                    <th className="p-2.5">Stock #</th>
                    <th className="p-2.5">Lot #</th>
                    <th className="p-2.5">VIN</th>
                    <th className="p-2.5">Year</th>
                    <th className="p-2.5">Make</th>
                    <th className="p-2.5">Model</th>
                    <th className="p-2.5">Engine</th>
                    <th className="p-2.5">Auction</th>
                    <th className="p-2.5">Purchase Date</th>
                    <th className="p-2.5">Transporter</th>
                    <th className="p-2.5">Arrival Date</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map((v) => {
                    const stage = auctionStageInfo(v);
                    return (
                      <tr key={v.id} className="hover:bg-accent/20">
                        <td className="p-2.5">
                          <Checkbox checked={selected.includes(v.id)} onCheckedChange={() => toggleOne(v.id)} aria-label={`Select ${v.vin || v.id}`} />
                        </td>
                        <td className="p-2.5">
                          <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Package className="size-4" />
                          </span>
                        </td>
                        <td className="p-2.5 font-medium whitespace-nowrap">{v.stockNumber || "—"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.lotNumber || "—"}</td>
                        <td className="p-2.5 font-mono text-xs whitespace-nowrap">{v.vin || "—"}</td>
                        <td className="p-2.5">{v.year || "—"}</td>
                        <td className="p-2.5">{v.make || "—"}</td>
                        <td className="p-2.5">{v.model || "—"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.engine || "—"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.auctionSource || "—"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.saleDate || "—"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.carrierName || "Not Assigned"}</td>
                        <td className="p-2.5 whitespace-nowrap">{v.arrivalDate || "—"}</td>
                        <td className="p-2.5">
                          <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>
                        </td>
                        <td className="p-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenVehicle(v.id)}>
                              View
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button size="icon-sm" variant="ghost" aria-label="More actions">
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                {v.closedReason ? (
                                  <DropdownMenuItem onClick={() => closeVehicle(v.id, v.closedReason as ClosedReason, undefined)}>
                                    Reopen vehicle
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => openClose(v)}>Close / Remove Vehicle</DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} vehicles
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  ‹
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <Button
                    key={n}
                    size="icon-sm"
                    variant={n === currentPage ? "default" : "outline"}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  ›
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon={CarFront} title="No vehicles found" description="Try a different filter or search term." />
        )}
      </section>

      <Dialog open={!!closeTarget} onOpenChange={(o) => !o && setCloseTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close / Remove Vehicle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {closeTarget && `${closeTarget.year} ${closeTarget.make} ${closeTarget.model}`} · Stock {closeTarget?.stockNumber || "—"}
            </p>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={closeReason} onValueChange={(v) => setCloseReason((v as ClosedReason) ?? "Other")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {closedReasonOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitClose}>Close Vehicle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
