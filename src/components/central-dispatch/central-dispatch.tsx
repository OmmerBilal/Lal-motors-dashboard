"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe2,
  MapPin,
  MoreHorizontal,
  Send,
  ShieldAlert,
  Truck,
  UserRound,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import {
  computeDispatchStats,
  groupByPickupLocation,
  isTransportOverdue,
  type TransportStatus,
  type VehicleRecord,
} from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { DispatchTable } from "@/components/central-dispatch/dispatch-table";
import { CarrierDirectoryModal } from "@/components/central-dispatch/carrier-directory-modal";
import {
  DispatchToCarrierModal,
  PrepareTransportationModal,
  ReportProblemModal,
  SendShareModal,
} from "@/components/central-dispatch/dispatch-modals";

type StatusTab = "byLocation" | "all" | TransportStatus | "overdue" | "problems";

const statusTabs: { id: StatusTab; label: string }[] = [
  { id: "byLocation", label: "Vehicles by Pickup Location" },
  { id: "all", label: "All Vehicles" },
  { id: "NEED_TRANSPORT", label: "Need Transport" },
  { id: "POSTED_TO_CD", label: "Posted to CD" },
  { id: "ASSIGNED", label: "Assigned" },
  { id: "IN_TRANSIT", label: "In Transit" },
  { id: "ARRIVED", label: "Arrived" },
  { id: "overdue", label: "Overdue" },
  { id: "problems", label: "Problems" },
];

const kpiCards: { key: keyof ReturnType<typeof computeDispatchStats>; label: string; sub: string; icon: typeof Truck; tone: string }[] = [
  { key: "needTransport", label: "Need Transport", sub: "Purchased, not posted", icon: Truck, tone: "slate" },
  { key: "postedToCd", label: "Posted to Central Dispatch", sub: "On load board", icon: Globe2, tone: "blue" },
  { key: "assigned", label: "Assigned to Carrier", sub: "Carrier accepted", icon: UserRound, tone: "purple" },
  { key: "inTransit", label: "In Transit", sub: "Picked up, on the way", icon: Truck, tone: "amber" },
  { key: "arrived", label: "Arrived", sub: "Delivered to yard", icon: CheckCircle2, tone: "green" },
  { key: "overdue", label: "Overdue", sub: "10+ days", icon: AlertTriangle, tone: "red" },
];

const cardTone: Record<string, string> = {
  slate: "border-border bg-muted/40 text-foreground",
  blue: "border-primary/20 bg-primary/6 text-primary",
  purple: "border-violet-500/20 bg-violet-500/6 text-violet-600 dark:text-violet-400",
  amber: "border-warning/25 bg-warning/10 text-warning-foreground",
  green: "border-success/20 bg-success/8 text-success",
  red: "border-destructive/20 bg-destructive/8 text-destructive",
};

export function CentralDispatch({ user }: { user: User }) {
  const router = useRouter();
  const { vehicles, carriers, setTransportStatus } = useVehicleData();
  const canEdit = ["owner", "engineer_admin", "manager", "auction"].includes(user.role);

  const [tab, setTab] = useState<StatusTab>("byLocation");
  const [search, setSearch] = useState("");
  const [auctionFilter, setAuctionFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [carrierModalOpen, setCarrierModalOpen] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [problemVehicle, setProblemVehicle] = useState<VehicleRecord | null>(null);

  const open = vehicles.filter((v) => !v.closedReason);
  const stats = computeDispatchStats(vehicles);
  const auctionOptions = useMemo(() => [...new Set(open.map((v) => v.auctionSource).filter(Boolean))].sort(), [open]);

  const filtered = useMemo(() => {
    let list = open;
    if (auctionFilter !== "all") list = list.filter((v) => v.auctionSource === auctionFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        [v.vin, v.stockNumber, v.lotNumber, v.pickupPin, v.make, v.model].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
      );
    }
    if (tab === "overdue") {
      return list.filter((v) => isTransportOverdue(v));
    }
    if (tab === "problems") return list.filter((v) => v.transportStatus === "PROBLEM");
    if (tab !== "all" && tab !== "byLocation") return list.filter((v) => v.transportStatus === tab);
    return list;
  }, [open, auctionFilter, search, tab]);

  const groups = useMemo(() => groupByPickupLocation(filtered), [filtered]);

  function openVehicle(v: VehicleRecord) {
    router.push(`/vehicles?open=${v.id}`);
  }

  function toggleOne(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleList(list: VehicleRecord[]) {
    const ids = list.map((v) => v.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected((s) => (allIn ? s.filter((id) => !ids.includes(id)) : [...new Set([...s, ...ids])]));
  }

  function advance(v: VehicleRecord) {
    if (v.transportStatus === "ASSIGNED") {
      setTransportStatus(v.id, "IN_TRANSIT");
      toast.success(`${v.year} ${v.make} ${v.model} marked picked up / in transit`);
    } else if (v.transportStatus === "IN_TRANSIT") {
      setTransportStatus(v.id, "ARRIVED");
      toast.success(`${v.year} ${v.make} ${v.model} marked arrived — confirm final receiving in Vehicle Receiving`);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Truck className="size-6 text-primary" /> Central Dispatch / Transportation
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage transportation for your purchased vehicles. Post to Central Dispatch, dispatch to your carriers, and
            track arrival.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <WifiOff className="size-4 text-muted-foreground" />
          <span>
            <b className="block text-foreground">Central Dispatch Integration</b>
            <span className="text-muted-foreground">Not Connected · UI Preview</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((c) => {
          const value = stats[c.key];
          return (
            <div key={c.key} className={`rounded-lg border p-3.5 ${cardTone[c.tone]}`}>
              <span className="flex size-8 items-center justify-center rounded-md bg-background/60">
                <c.icon className="size-4" />
              </span>
              <b className="mt-2 block text-2xl font-bold tabular-nums">{value}</b>
              <span className="block text-xs font-semibold">{c.label}</span>
              <span className="block text-[11px] opacity-80">{c.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {statusTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 max-w-xs text-sm"
          placeholder="Search by VIN, Stock/Lot #, PIN, Make, Model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={auctionFilter} onValueChange={(v) => setAuctionFilter(v || "all")}>
          <SelectTrigger className="h-9 w-40 text-xs">
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
        {canEdit && (
          <Button variant="outline" size="sm" className="h-9 ml-auto" onClick={() => setCarrierModalOpen(true)}>
            <UserRound className="size-3.5" /> Carrier Directory
          </Button>
        )}
      </div>

      {selected.length > 0 && canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <span className="text-sm font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => setPrepareOpen(true)}>
            <Globe2 className="size-3.5" /> Post to Central Dispatch
          </Button>
          <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" onClick={() => setDispatchOpen(true)}>
            <Truck className="size-3.5" /> Dispatch to Carrier
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
            <Send className="size-3.5" /> Send / Share List
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="outline">
                  More Actions <MoreHorizontal className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setCarrierModalOpen(true)}>Carrier Directory</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelected([])}>Clear Selection</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      {!filtered.length && (
        <EmptyState icon={Truck} title="No vehicles match this view" description="Try a different status, auction or search term." />
      )}

      {filtered.length > 0 && tab === "byLocation" && (
        <div className="space-y-3">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.name];
            const groupStats = computeDispatchStats(g.vehicles);
            return (
              <div key={g.name} className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-3 p-3.5">
                  <button onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))} className="text-muted-foreground">
                    {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                  {canEdit && (
                    <Checkbox
                      checked={g.vehicles.every((v) => selected.includes(v.id))}
                      onCheckedChange={() => toggleList(g.vehicles)}
                      aria-label={`Select all in ${g.name}`}
                    />
                  )}
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <MapPin className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{g.name}</b>
                    <small className="block truncate text-xs text-muted-foreground">{g.address || "Address not on file"}</small>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {g.vehicles.length} Vehicle{g.vehicles.length === 1 ? "" : "s"}
                  </span>
                  {groupStats.needTransport > 0 && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                      {groupStats.needTransport} Need Transport
                    </span>
                  )}
                  {groupStats.postedToCd > 0 && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {groupStats.postedToCd} Posted
                    </span>
                  )}
                  {groupStats.inTransit > 0 && (
                    <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-foreground">
                      {groupStats.inTransit} In Transit
                    </span>
                  )}
                  {groupStats.overdue > 0 && (
                    <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
                      {groupStats.overdue} Overdue
                    </span>
                  )}
                </div>
                {!isCollapsed && (
                  <div className="border-t border-border p-3">
                    <DispatchTable
                      vehicles={g.vehicles}
                      selected={selected}
                      onToggle={toggleOne}
                      onToggleAll={() => toggleList(g.vehicles)}
                      onView={openVehicle}
                      onReportProblem={setProblemVehicle}
                      onAdvance={advance}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && tab !== "byLocation" && (
        <DispatchTable
          vehicles={filtered}
          selected={selected}
          onToggle={toggleOne}
          onToggleAll={() => toggleList(filtered)}
          onView={openVehicle}
          onReportProblem={setProblemVehicle}
          onAdvance={advance}
        />
      )}

      <p className="text-xs text-muted-foreground">
        <ShieldAlert className="mr-1 inline size-3.5 align-text-bottom" />
        Total vehicles: {vehicles.length} · Showing {filtered.length} in this view
      </p>

      <CarrierDirectoryModal open={carrierModalOpen} onOpenChange={setCarrierModalOpen} />
      <PrepareTransportationModal
        open={prepareOpen}
        vehicleIds={selected}
        onOpenChange={setPrepareOpen}
        onDone={() => {
          setPrepareOpen(false);
          setSelected([]);
        }}
      />
      <DispatchToCarrierModal
        open={dispatchOpen}
        vehicleIds={selected}
        carriers={carriers}
        onOpenChange={setDispatchOpen}
        onAddCarrier={() => {
          setDispatchOpen(false);
          setCarrierModalOpen(true);
        }}
        onDone={() => {
          setDispatchOpen(false);
          setSelected([]);
        }}
      />
      <SendShareModal open={shareOpen} vehicleIds={selected} onOpenChange={setShareOpen} />
      <ReportProblemModal vehicle={problemVehicle} onOpenChange={(o) => !o && setProblemVehicle(null)} />
    </div>
  );
}
