"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Send, Truck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cash, lotOrStockDisplay, transportProblemReasons, type Carrier, type VehicleRecord } from "@/lib/mock/vehicles";
import { useAssignCarrierItems, useUpdateTransportStatus } from "@/lib/query/dispatch";

/**
 * Central Dispatch posting. The external API is not connected in this environment, so this shows the payload that
 * would be sent and writes nothing: no vehicle is marked as posted, and no external call is made.
 */
export function PrepareTransportationModal({
  open,
  vehicles,
  onOpenChange,
}: {
  open: boolean;
  vehicles: VehicleRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  const payload = vehicles.map((v) => ({
    vin: v.vin || null,
    lot: v.lotNumber || null,
    stock: v.stockNumber || null,
    vehicle: [v.year, v.make, v.model].filter(Boolean).join(" ") || null,
    pickup_location: v.pickupLocationName || null,
    pickup_address: v.pickupAddress || null,
    pickup_pin: v.pickupPin || null,
  }));

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("Payload copied. Nothing was posted.");
    } catch {
      toast.error("Copy is not available in this browser. Select the text instead.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Post to Central Dispatch</DialogTitle>
        </DialogHeader>
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            <b>Not Connected · UI Preview.</b> The Central Dispatch API is not connected, so nothing is posted and no vehicle&apos;s status changes.
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          This is the information taken from each vehicle&apos;s master record, shown so you can check it before the API is connected.
        </p>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border p-2 text-xs">
          {vehicles.length === 0 && <p className="text-muted-foreground">No vehicles selected.</p>}
          {vehicles.map((v) => (
            <div key={v.id} className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <b>{[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}</b> · VIN {v.vin || "—"} · Lot {v.lotNumber || "—"} · Pickup {v.pickupLocationName || "—"}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" disabled={vehicles.length === 0} onClick={copyPayload}>
            <Copy className="size-4" /> Copy payload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DispatchToCarrierModal({
  open,
  vehicles,
  carriers,
  onOpenChange,
  onAddCarrier,
  onDone,
}: {
  open: boolean;
  vehicles: VehicleRecord[];
  carriers: Carrier[];
  onOpenChange: (open: boolean) => void;
  onAddCarrier: () => void;
  onDone: () => void;
}) {
  const assignMutation = useAssignCarrierItems();
  const [carrierId, setCarrierId] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});

  const chosen = vehicles;
  const pickupLocations = [...new Set(chosen.map((v) => v.pickupLocationName).filter(Boolean))];
  const total = chosen.reduce((s, v) => s + (Number(prices[v.id] ?? v.transportPrice) || 0), 0);
  const carrier = carriers.find((c) => c.id === carrierId);

  /** The dialog closes only after the server accepts the assignment. A refusal keeps the selection and the prices. */
  function confirm() {
    if (!carrierId) return;
    const items = chosen.map((v) => ({ vehicleId: v.id, transportPrice: Number(prices[v.id] ?? v.transportPrice) }));
    if (items.some((i) => !(i.transportPrice > 0))) {
      toast.error("Enter a transport price above zero for every vehicle.");
      return;
    }
    assignMutation.mutate(
      { carrierId, items },
      {
        onSuccess: (r) => {
          toast.success(`${r.assigned} vehicle(s) dispatched to ${carrier?.company}`);
          setPrices({});
          setCarrierId("");
          onDone();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Nothing was assigned. Try again."),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dispatch to Carrier</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
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
          </div>

          <p className="text-xs text-muted-foreground">
            {chosen.length} vehicle(s) · Pickup: {pickupLocations.join(", ") || "—"}
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

/** Local copy only. Email, text and share links are not connected, so they are not offered. */
export function SendShareModal({
  open,
  vehicles,
  onOpenChange,
}: {
  open: boolean;
  vehicles: VehicleRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  const text = vehicles
    .map((v) => `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"} · VIN ${v.vin || "—"} · Lot ${v.lotNumber || "—"} · Pickup ${v.pickupLocationName || "—"}`)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("List copied to the clipboard");
      onOpenChange(false);
    } catch {
      toast.error("Copy is not available in this browser. Select the list instead.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Copy vehicle list</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Copies {vehicles.length} selected vehicle(s) as text. Email, text messages and share links are not connected yet.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={vehicles.length === 0} onClick={copy}>
            <Copy className="size-4" /> Copy list
          </Button>
        </DialogFooter>
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
  const transportMutation = useUpdateTransportStatus();
  const [reason, setReason] = useState(transportProblemReasons[0]);
  const [note, setNote] = useState("");

  /** Closes only after the database accepts the problem. A refusal keeps the note on screen. */
  function submit() {
    if (!vehicle) return;
    transportMutation.mutate(
      { vehicleId: vehicle.id, to: "PROBLEM", note: note ? `${reason}: ${note}` : reason },
      {
        onSuccess: () => {
          toast.success("Transportation problem recorded");
          setNote("");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not record the problem. Your note is still here."),
      }
    )
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
