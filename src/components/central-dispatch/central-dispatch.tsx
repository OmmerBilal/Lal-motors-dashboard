"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Globe, Globe2, MapPin, MoreHorizontal, Send, ShieldAlert, Truck, UserRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import type { VehicleRecord } from "@/lib/mock/vehicles";
import {
  useCarriers,
  useDispatchCounts,
  useGroupVehicles,
  usePickupGroups,
  useUpdateTransportStatus,
} from "@/lib/query/dispatch";
import { useVehicleFilterOptions } from "@/lib/query/vehicles";
import { toVehicleRecord } from "@/lib/data/vehicle-record";
import { groupKeyFor, type DispatchFilters, type PickupGroup } from "@/lib/data/dispatch-read";
import { DispatchTable } from "@/components/central-dispatch/dispatch-table";
import { CarrierDirectoryModal } from "@/components/central-dispatch/carrier-directory-modal";
import { PickupLocationDialog } from "@/components/central-dispatch/pickup-location-dialog";
import {
  DispatchToCarrierModal,
  PrepareTransportationModal,
  ReportProblemModal,
  SendShareModal,
} from "@/components/central-dispatch/dispatch-modals";

/**
 * Central Dispatch. Pickup-location summaries come from the server one page at a time. A location's vehicles load
 * only when it is opened, one page at a time. Selection keeps the full records of what was picked, so the dialogs
 * never need the whole table. The external Central Dispatch API is not connected.
 */

type StatusTab = "byLocation" | "all" | "NEED_TRANSPORT" | "POSTED_TO_CD" | "ASSIGNED" | "IN_TRANSIT" | "ARRIVED" | "overdue" | "PROBLEM";

const statusTabs: { id: StatusTab; label: string }[] = [
  { id: "byLocation", label: "By Pickup Location" },
  { id: "all", label: "All Vehicles" },
  { id: "NEED_TRANSPORT", label: "Need Transport" },
  { id: "POSTED_TO_CD", label: "Posted to CD" },
  { id: "ASSIGNED", label: "Assigned" },
  { id: "IN_TRANSIT", label: "In Transit" },
  { id: "ARRIVED", label: "Arrived" },
  { id: "overdue", label: "Overdue" },
  { id: "PROBLEM", label: "Problems" },
];

const kpiCards: { key: "needTransport" | "postedToCd" | "assigned" | "inTransit" | "arrived" | "overdue"; label: string; sub: string; icon: typeof Truck; tone: string }[] = [
  { key: "needTransport", label: "Need Transport", sub: "Purchased, not posted", icon: Truck, tone: "slate" },
  { key: "postedToCd", label: "Posted to Central Dispatch", sub: "On load board", icon: Globe2, tone: "blue" },
  { key: "assigned", label: "Assigned to Carrier", sub: "Carrier accepted", icon: UserRound, tone: "purple" },
  { key: "inTransit", label: "In Transit", sub: "Picked up, on the way", icon: Truck, tone: "amber" },
  { key: "arrived", label: "Arrived", sub: "Delivered to yard", icon: Globe, tone: "green" },
  { key: "overdue", label: "Overdue", sub: "10+ days", icon: ShieldAlert, tone: "red" },
];

// Solid fills, matching the reference dashboard's KPI tiles (see kpi-grid.tsx) — not light tints.
const cardTone: Record<string, string> = {
  slate: "bg-tone-grey",
  blue: "bg-tone-blue",
  purple: "bg-tone-purple",
  amber: "bg-tone-orange",
  green: "bg-tone-green",
  red: "bg-tone-red",
};

const EDIT_ROLES = ["owner", "engineer_admin", "manager", "auction"];

/** One pickup location. Its vehicles load only while it is open. */
function PickupGroupCard({
  group,
  filters,
  canEdit,
  selectedIds,
  onToggle,
  onToggleLoaded,
  onView,
  onReportProblem,
  onAdvance,
  onEditLocation,
}: {
  group: PickupGroup;
  filters: DispatchFilters;
  canEdit: boolean;
  selectedIds: string[];
  onToggle: (v: VehicleRecord) => void;
  onToggleLoaded: (list: VehicleRecord[]) => void;
  onView: (v: VehicleRecord) => void;
  onReportProblem: (v: VehicleRecord) => void;
  onAdvance: (v: VehicleRecord) => void;
  onEditLocation: (v: VehicleRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const key = groupKeyFor(group);
  const vehicles = useGroupVehicles(key, filters, open);
  const records = useMemo(
    () => (vehicles.data?.pages.flatMap((p) => p.rows) ?? []).map((row) => toVehicleRecord(row)),
    [vehicles.data],
  );
  const loadedAll = open && vehicles.isSuccess && !vehicles.hasNextPage;
  const allSelected = records.length > 0 && records.every((r) => selectedIds.includes(r.id));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Open"} ${group.name}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40"
        >
          {open ? <ChevronDown className="size-5" /> : <ChevronRight className="size-5" />}
        </button>
        {canEdit && open && (
          <Checkbox
            checked={allSelected}
            disabled={records.length === 0}
            onCheckedChange={() => onToggleLoaded(records)}
            aria-label={`Select loaded vehicles in ${group.name}`}
          />
        )}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <MapPin className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm">{group.name}</b>
          <small className="block truncate text-xs text-muted-foreground">{group.address || "Address not on file"}</small>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {group.vehicle_count} Vehicle{group.vehicle_count === 1 ? "" : "s"}
        </span>
        {group.need_transport > 0 && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">{group.need_transport} Need Transport</span>}
        {group.posted > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{group.posted} Posted</span>}
        {group.in_transit > 0 && <span className="rounded-full bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning-foreground">{group.in_transit} In Transit</span>}
        {group.overdue > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">{group.overdue} Overdue</span>}
      </div>

      {open && (
        <div className="space-y-2 border-t border-border p-3">
          {vehicles.isPending && <p className="text-sm text-muted-foreground" aria-live="polite">Loading vehicles…</p>}
          {vehicles.isError && <p role="alert" className="text-sm text-destructive">{vehicles.error instanceof Error ? vehicles.error.message : "Vehicles could not be loaded."}</p>}
          {vehicles.isSuccess && records.length === 0 && <p className="text-sm text-muted-foreground">No vehicles in this location for this view.</p>}
          {records.length > 0 && (
            <DispatchTable
              vehicles={records}
              selected={selectedIds}
              onToggle={(id) => {
                const rec = records.find((r) => r.id === id);
                if (rec) onToggle(rec);
              }}
              onToggleAll={() => onToggleLoaded(records)}
              onView={onView}
              onReportProblem={onReportProblem}
              onAdvance={onAdvance}
              canEdit={canEdit}
              onEditLocation={onEditLocation}
            />
          )}
          {vehicles.hasNextPage && (
            <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => vehicles.fetchNextPage()} disabled={vehicles.isFetchingNextPage}>
              {vehicles.isFetchingNextPage ? "Loading…" : "Load more vehicles in this location"}
            </Button>
          )}
          {canEdit && loadedAll && <p className="text-xs text-muted-foreground">All {records.length} vehicles in this location are loaded.</p>}
        </div>
      )}
    </div>
  );
}

export function CentralDispatch({ user }: { user: User }) {
  const router = useRouter();
  const countsQuery = useDispatchCounts();
  const carriersQuery = useCarriers();
  const optionsQuery = useVehicleFilterOptions();
  const transportMutation = useUpdateTransportStatus();
  const carriers = carriersQuery.data ?? [];
  const dc = countsQuery.data;
  const canEdit = EDIT_ROLES.includes(user.role);

  const [tab, setTab] = useState<StatusTab>("byLocation");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [auctionFilter, setAuctionFilter] = useState("all");
  const [selectedMap, setSelectedMap] = useState<Record<string, VehicleRecord>>({});
  const [carrierModalOpen, setCarrierModalOpen] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [problemVehicle, setProblemVehicle] = useState<VehicleRecord | null>(null);
  const [locationVehicle, setLocationVehicle] = useState<VehicleRecord | null>(null);

  const filters: DispatchFilters = { tab, search: submittedSearch, auction: auctionFilter === "all" ? null : auctionFilter };
  const groups = usePickupGroups(filters);
  const groupList = groups.data?.pages.flatMap((p) => p.groups) ?? [];

  const selectedIds = Object.keys(selectedMap);
  const selectedVehicles = Object.values(selectedMap);
  const auctionOptions = (optionsQuery.data?.auction_sources as string[] | undefined) ?? [];

  function setTransportStatus(vehicleId: string, to: string) {
    transportMutation.mutate(
      { vehicleId, to },
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update the transport status.") },
    );
  }

  function toggleOne(v: VehicleRecord) {
    setSelectedMap((m) => {
      const next = { ...m };
      if (next[v.id]) delete next[v.id];
      else next[v.id] = v;
      return next;
    });
  }

  function toggleLoaded(list: VehicleRecord[]) {
    setSelectedMap((m) => {
      const next = { ...m };
      const allIn = list.every((v) => next[v.id]);
      for (const v of list) {
        if (allIn) delete next[v.id];
        else next[v.id] = v;
      }
      return next;
    });
  }

  function openVehicle(v: VehicleRecord) {
    router.push(`/vehicles?open=${v.id}`);
  }

  function advance(v: VehicleRecord) {
    if (v.transportStatus === "ASSIGNED") {
      setTransportStatus(v.id, "IN_TRANSIT");
      toast.success(`${v.year} ${v.make} ${v.model} marked picked up / in transit`);
    } else if (v.transportStatus === "IN_TRANSIT") {
      setTransportStatus(v.id, "ARRIVED");
      toast.success(`${v.year} ${v.make} ${v.model} marked arrived. Confirm final receiving in Vehicle Receiving.`);
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
            Group vehicles by pickup location, dispatch them to a carrier, and track arrival.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <WifiOff className="size-4 text-muted-foreground" />
          <span>
            <b className="block text-foreground">External posting (3rd-party Central Dispatch load board)</b>
            <span className="text-muted-foreground">Not connected — internal carrier assignment and tracking below are fully functional</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((c) => (
          <div key={c.key} className={`rounded-lg p-3.5 text-white shadow-sm ${cardTone[c.tone]}`}>
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/20">
              <c.icon className="size-5" strokeWidth={2.25} />
            </span>
            <b className="mt-2 block text-2xl font-bold tabular-nums">{dc ? dc[c.key] ?? 0 : "…"}</b>
            <span className="block text-xs font-semibold text-white/90">{c.label}</span>
            <span className="block text-[11px] text-white/70">{c.sub}</span>
          </div>
        ))}
      </div>

      <div role="tablist" className="flex gap-1.5 overflow-x-auto border-b border-border pb-2">
        {statusTabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${tab === t.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedSearch(search.trim());
        }}
      >
        <Input
          className="h-11 max-w-xs text-sm"
          placeholder="Search by VIN, Stock/Lot #, PIN, Make, Model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search dispatch vehicles"
        />
        <Select value={auctionFilter} onValueChange={(v) => setAuctionFilter(v || "all")}>
          <SelectTrigger className="h-11 w-40 text-xs">
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
        <Button type="submit" variant="secondary" className="min-h-11">
          Search
        </Button>
        {canEdit && (
          <Button variant="outline" className="min-h-11 sm:ml-auto" onClick={() => setCarrierModalOpen(true)}>
            <UserRound className="size-4" /> Carrier Directory
          </Button>
        )}
      </form>

      {selectedIds.length > 0 && canEdit && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-background p-3 shadow-sm">
          <span className="text-sm font-semibold">{selectedIds.length} selected</span>
          <Button className="min-h-11" onClick={() => setDispatchOpen(true)}>
            <Truck className="size-4" /> Dispatch to Carrier
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => setPrepareOpen(true)}>
            <Globe2 className="size-4" /> Post to Central Dispatch
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" className="min-h-11">
                  More <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setShareOpen(true)}>
                <Send className="size-4" /> Copy list
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCarrierModalOpen(true)}>Carrier Directory</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedMap({})}>Clear selection</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {groups.isPending && <p className="text-sm text-muted-foreground" aria-live="polite">Loading pickup locations…</p>}
      {groups.isError && <p role="alert" className="text-sm text-destructive">{groups.error instanceof Error ? groups.error.message : "Pickup locations could not be loaded."}</p>}
      {groups.isSuccess && groupList.length === 0 && (
        <EmptyState icon={Truck} title="No vehicles match this view" description="Try a different status, auction or search term." />
      )}

      {groupList.length > 0 && (
        <div className="space-y-3">
          {groupList.map((g) => (
            <PickupGroupCard
              key={groupKeyFor(g)}
              group={g}
              filters={filters}
              canEdit={canEdit}
              selectedIds={selectedIds}
              onToggle={toggleOne}
              onToggleLoaded={toggleLoaded}
              onView={openVehicle}
              onReportProblem={setProblemVehicle}
              onAdvance={advance}
              onEditLocation={setLocationVehicle}
            />
          ))}
        </div>
      )}
      {groups.hasNextPage && (
        <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => groups.fetchNextPage()} disabled={groups.isFetchingNextPage}>
          {groups.isFetchingNextPage ? "Loading…" : "Load more pickup locations"}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        <ShieldAlert className="mr-1 inline size-3.5 align-text-bottom" />
        Showing {groupList.length} pickup location(s) · {selectedIds.length} selected
      </p>

      <CarrierDirectoryModal open={carrierModalOpen} onOpenChange={setCarrierModalOpen} />
      <PrepareTransportationModal
        open={prepareOpen}
        vehicles={selectedVehicles}
        onOpenChange={setPrepareOpen}
      />
      <DispatchToCarrierModal
        open={dispatchOpen}
        vehicles={selectedVehicles}
        carriers={carriers}
        onOpenChange={setDispatchOpen}
        onAddCarrier={() => {
          setDispatchOpen(false);
          setCarrierModalOpen(true);
        }}
        onDone={() => {
          setDispatchOpen(false);
          setSelectedMap({});
        }}
      />
      <SendShareModal open={shareOpen} vehicles={selectedVehicles} onOpenChange={setShareOpen} />
      <ReportProblemModal vehicle={problemVehicle} onOpenChange={(o) => !o && setProblemVehicle(null)} />
      <PickupLocationDialog key={locationVehicle?.id ?? "closed"} vehicle={locationVehicle} onOpenChange={(o) => !o && setLocationVehicle(null)} />
    </div>
  );
}

