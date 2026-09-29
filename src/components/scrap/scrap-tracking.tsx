"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, ClipboardCheck, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { localDay } from "@/lib/mock/scrap";
import { ScrapDataProvider, useScrapData } from "@/components/scrap/scrap-data-context";
import { LoadCard } from "@/components/scrap/load-card";

function WorkspaceBody({
  user,
  onOpenUsers,
  initialLoadId,
  previewDriverId,
  previewMode = false,
}: {
  user: User;
  onOpenUsers?: () => void;
  initialLoadId?: string;
  previewDriverId?: string;
  previewMode?: boolean;
}) {
  const driver = user.role === "scrap_driver";
  const canCreate = driver || user.role === "owner" || user.role === "engineer_admin";
  const { loads, checks, drivers, createLoad, saveCheck } = useScrapData();

  const [from, setFrom] = useState(localDay());
  const [to, setTo] = useState(localDay());
  const [newOpen, setNewOpen] = useState(false);
  const [newDriver, setNewDriver] = useState("");
  const [loadPhoto, setLoadPhoto] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialLoadId ?? null);
  const [checkDriver, setCheckDriver] = useState("");
  const [checkDate, setCheckDate] = useState(localDay());
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPhoto, setCheckPhoto] = useState("");

  const effectiveDriverId = driver ? user.id : previewMode ? previewDriverId : undefined;

  const filteredLoads = useMemo(() => {
    let list = loads.filter((l) => l.loadDate >= from && l.loadDate <= to);
    if (effectiveDriverId) list = list.filter((l) => l.driverId === effectiveDriverId);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [loads, from, to, effectiveDriverId]);

  const totals = useMemo(() => {
    const scoped = loads.filter((l) => l.loadDate >= from && l.loadDate <= to && (!effectiveDriverId || l.driverId === effectiveDriverId));
    const byDriver = new Map<string, { driverId: string; driverName: string; loads: number; totalWeight: number; totalAmount: number; ticketCount: number; checkIds: Set<string> }>();
    for (const l of scoped) {
      const entry = byDriver.get(l.driverId) ?? { driverId: l.driverId, driverName: l.driverName, loads: 0, totalWeight: 0, totalAmount: 0, ticketCount: 0, checkIds: new Set<string>() };
      entry.loads += 1;
      entry.totalWeight += l.weightAmount || 0;
      entry.totalAmount += l.amount || 0;
      if (l.ticketUploadedAt) entry.ticketCount += 1;
      if (l.checkId) entry.checkIds.add(l.checkId);
      byDriver.set(l.driverId, entry);
    }
    return [...byDriver.values()];
  }, [loads, from, to, effectiveDriverId]);

  const ready = useMemo(
    () => loads.filter((l) => l.driverId === checkDriver && l.loadDate === checkDate && !l.checkId && l.ticketUploadedAt && l.weightAmount !== null && l.amount !== null && l.ticketNumber),
    [loads, checkDriver, checkDate]
  );

  function saveNewLoad() {
    const isAdmin = user.role === "owner" || user.role === "engineer_admin";
    const driverId = previewMode ? previewDriverId! : isAdmin ? newDriver : user.id;
    const driverName = driver ? user.name : previewMode ? drivers.find((d) => d.id === driverId)?.name || user.name : drivers.find((d) => d.id === driverId)?.name || "";
    if (!driverId) return;
    const created = createLoad(driverId, driverName, localDay());
    setLoadPhoto("");
    setNewOpen(false);
    setFrom(created.loadDate);
    setTo(created.loadDate);
    setSelectedId(created.id);
    toast.success("Load saved. Open this same load after delivery to add its yard ticket photo.");
  }

  function saveCheckForReady() {
    const linked = saveCheck(checkDriver, checkDate, checkNumber.trim());
    setCheckNumber("");
    setCheckPhoto("");
    toast.success(`Check saved and linked to ${linked} load(s).`);
  }

  const newLoadDisabled =
    !loadPhoto ||
    ((user.role === "owner" || user.role === "engineer_admin") && !previewMode && !newDriver) ||
    (previewMode && !previewDriverId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Scrap Driver Tracking</p>
          <h2 className="mt-1 text-xl font-semibold">{driver ? "My Scrap Loads" : "Scrap Loads & Driver Totals"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {driver
              ? "One load for each trip. Save its photo before leaving, then return to this load to add the yard ticket."
              : "Open each load to verify its ticket, weight and amount. Reconcile ready loads with the end-of-day check."}
          </p>
          {canCreate && (
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                setNewOpen(true);
                setSelectedId(null);
              }}
            >
              + New Scrap Load
            </Button>
          )}
        </div>
        {!driver && <Truck className="size-9 text-muted-foreground" />}
      </div>

      {(user.role === "owner" || user.role === "engineer_admin") && !drivers.length && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h3 className="mb-1 text-sm font-semibold">Set up your first scrap driver</h3>
          <p className="mb-2 text-sm text-muted-foreground">
            No active Scrap Driver account exists yet. Invite the driver under Users &amp; Activity, then each trip can be assigned to that person.
          </p>
          <Button size="sm" onClick={onOpenUsers}>
            Open Users &amp; Activity
          </Button>
        </div>
      )}

      {canCreate && newOpen && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Step 1 · New scrap load</h3>
            <Button variant="ghost" size="sm" onClick={() => { setNewOpen(false); setLoadPhoto(""); }}>
              Cancel
            </Button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">Take a photo of this load before leaving the yard.</p>
          {(user.role === "owner" || user.role === "engineer_admin") && !previewMode && (
            <div className="mb-3 max-w-xs space-y-1.5">
              <Label>Assign to driver</Label>
              <Select value={newDriver} onValueChange={(v) => setNewDriver(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select active Scrap Driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {previewMode && !previewDriverId && <p className="mb-3 text-sm text-warning-foreground">Select an active Scrap Driver above to save this load.</p>}
          <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-semibold text-primary">
            <Camera className="size-4" /> {loadPhoto || "Take or upload load photo"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setLoadPhoto(e.target.files?.[0]?.name || "")} />
          </label>
          <div>
            <Button disabled={newLoadDisabled} onClick={saveNewLoad}>
              Save this load
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{driver ? "My loads" : "Date range & driver totals"}</h3>
          <Button variant="ghost" size="icon" aria-label="Refresh scrap loads">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>
        {!driver &&
          (totals.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {totals.map((t) => (
                <div key={t.driverId} className="rounded-md border border-border p-3">
                  <strong className="block text-sm">{t.driverName}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {t.loads} loads · {t.totalWeight.toLocaleString()} lb
                  </span>
                  <span className="block text-xs text-muted-foreground">${t.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</span>
                  <small className="text-xs text-muted-foreground">
                    {t.ticketCount} tickets · {t.checkIds.size} checks
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No scrap loads in this date range.</p>
          ))}
      </div>

      {!driver && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">End-of-day check</h3>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Driver</Label>
              <Select value={checkDriver} onValueChange={(v) => setCheckDriver(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select driver" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Load day</Label>
              <Input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
            </div>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {ready.length} ready load{ready.length === 1 ? "" : "s"} for this driver and day. Ticket photo, weight, amount and ticket number are required.
          </p>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Check number</Label>
              <Input value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} placeholder="Check #" />
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 self-end rounded-md border border-dashed border-border px-3 py-2 text-sm font-semibold text-primary">
              <Camera className="size-4" /> {checkPhoto || "Take or upload check photo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setCheckPhoto(e.target.files?.[0]?.name || "")} />
            </label>
          </div>
          <Button disabled={!checkDriver || !checkPhoto || !checkNumber.trim() || !ready.length} onClick={saveCheckForReady}>
            <ClipboardCheck /> Save check for ready loads
          </Button>
          {checks.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{checks.length} check(s) recorded in this session.</p>}
        </div>
      )}

      <div className="space-y-2">
        {filteredLoads.length ? (
          filteredLoads.map((l) => (
            <LoadCard
              key={l.id}
              load={l}
              isDriver={driver}
              isOpen={selectedId === l.id}
              onToggle={() => {
                setSelectedId(selectedId === l.id ? null : l.id);
                setNewOpen(false);
              }}
            />
          ))
        ) : (
          <EmptyState title="No scrap loads in this date range." />
        )}
      </div>
    </div>
  );
}

export function ScrapTracking(props: {
  user: User;
  onOpenUsers?: () => void;
  initialLoadId?: string;
  previewDriverId?: string;
  previewMode?: boolean;
}) {
  return (
    <ScrapDataProvider>
      <WorkspaceBody {...props} />
    </ScrapDataProvider>
  );
}
