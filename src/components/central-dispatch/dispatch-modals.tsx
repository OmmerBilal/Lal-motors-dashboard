"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Globe2, Link2, Mail, MessageSquare, Send, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cash, lotOrStockDisplay, transportProblemReasons, type Carrier, type VehicleRecord } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

function SelectedVehiclesList({ vehicles }: { vehicles: VehicleRecord[] }) {
  return (
    <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
      {vehicles.map((v) => (
        <div key={v.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
          <span>
            <b>
              {v.year} {v.make} {v.model}
            </b>{" "}
            · {lotOrStockDisplay(v)} · {v.pickupLocationName || "—"}
          </span>
          <span className="text-muted-foreground">{v.transportPrice ? cash(v.transportPrice) : "No price yet"}</span>
        </div>
      ))}
    </div>
  );
}

export function PrepareTransportationModal({
  open,
  vehicleIds,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  vehicleIds: string[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { vehicles, postToCentralDispatch } = useVehicleData();
  const chosen = useMemo(() => vehicles.filter((v) => vehicleIds.includes(v.id)), [vehicles, vehicleIds]);

  function confirm() {
    postToCentralDispatch(vehicleIds);
    toast.success(`${vehicleIds.length} vehicle(s) posted to Central Dispatch`);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prepare Transportation</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Existing vehicle, VIN and pickup information is pulled automatically from the master record — nothing to
          re-enter.
        </p>
        <SelectedVehiclesList vehicles={chosen} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm}>
            <Globe2 className="size-4" /> Post to Central Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DispatchToCarrierModal({
  open,
  vehicleIds,
  carriers,
  onOpenChange,
  onAddCarrier,
  onDone,
}: {
  open: boolean;
  vehicleIds: string[];
  carriers: Carrier[];
  onOpenChange: (open: boolean) => void;
  onAddCarrier: () => void;
  onDone: () => void;
}) {
  const { vehicles, assignCarrier } = useVehicleData();
  const [carrierId, setCarrierId] = useState("");
  const [destination, setDestination] = useState("LAL Motors Yard");
  const [prices, setPrices] = useState<Record<string, string>>({});

  const chosen = useMemo(() => vehicles.filter((v) => vehicleIds.includes(v.id)), [vehicles, vehicleIds]);
  const pickupLocations = useMemo(() => [...new Set(chosen.map((v) => v.pickupLocationName).filter(Boolean))], [chosen]);
  const total = chosen.reduce((s, v) => s + (Number(prices[v.id] ?? v.transportPrice) || 0), 0);
  const carrier = carriers.find((c) => c.id === carrierId);

  function confirm() {
    if (!carrierId) return;
    assignCarrier(vehicleIds, carrierId, prices);
    toast.success(`${vehicleIds.length} vehicle(s) dispatched to ${carrier?.company}`);
    setPrices({});
    setCarrierId("");
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dispatch to Carrier</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Carrier</Label>
              <Select value={carrierId} onValueChange={(v) => setCarrierId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company} · {c.driver}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={onAddCarrier}>
                + Add New Carrier
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery location</Label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {chosen.length} vehicle(s) · Pickup: {pickupLocations.join(", ") || "—"} · Delivery: {destination}
          </p>

          <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
            {chosen.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 truncate">
                  <b>
                    {v.year} {v.make} {v.model}
                  </b>{" "}
                  · {lotOrStockDisplay(v)}
                </span>
                <Input
                  aria-label={`Price for ${v.vin || v.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-7 w-24 shrink-0 text-xs"
                  placeholder={v.transportPrice || "0.00"}
                  value={prices[v.id] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [v.id]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <p className="text-right text-sm font-semibold">Total: {cash(total)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!carrierId} onClick={confirm}>
            <Truck className="size-4" /> Confirm Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SendShareModal({
  open,
  vehicleIds,
  onOpenChange,
}: {
  open: boolean;
  vehicleIds: string[];
  onOpenChange: (open: boolean) => void;
}) {
  function mock(label: string) {
    toast.info(`${label} (mock — no real delivery in this UI phase)`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send / Share Vehicle List</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Share {vehicleIds.length} selected vehicle(s) as a list.</p>
        <div className="space-y-2">
          <Button variant="outline" className="w-full justify-start" onClick={() => mock("Emailed vehicle list")}>
            <Mail className="size-4" /> Email vehicle list
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => mock("Texted vehicle list")}>
            <MessageSquare className="size-4" /> Text vehicle list
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => mock("Copied share link")}>
            <Link2 className="size-4" /> Copy share link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReportProblemModal({
  vehicle,
  onOpenChange,
}: {
  vehicle: VehicleRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { reportTransportProblem } = useVehicleData();
  const [reason, setReason] = useState(transportProblemReasons[0]);
  const [note, setNote] = useState("");

  function submit() {
    if (!vehicle) return;
    reportTransportProblem(vehicle.id, reason, note || undefined);
    toast.success("Transportation problem recorded");
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog open={!!vehicle} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report Transportation Problem</DialogTitle>
        </DialogHeader>
        {vehicle && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {vehicle.year} {vehicle.make} {vehicle.model} · {lotOrStockDisplay(vehicle)}
            </p>
            <div className="space-y-1.5">
              <Label>Problem type</Label>
              <Select value={reason} onValueChange={(v) => setReason(v ?? transportProblemReasons[0])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {transportProblemReasons.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Optional details" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit}>
            <Send className="size-4" /> Log Problem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
