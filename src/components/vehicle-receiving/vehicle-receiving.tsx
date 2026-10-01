"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  CarFront,
  CheckCircle2,
  Clock3,
  Plus,
  ScanLine,
  Search,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { User } from "@/lib/types";
import { transportStatusLabels, type VehicleRecord } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

type Step = "scan" | "match" | "already" | "nomatch" | "photos" | "confirm" | "success";

const requiredPhotoSlots = [
  { id: "front", label: "Front View" },
  { id: "rear", label: "Rear View" },
  { id: "left", label: "Left Side" },
  { id: "right", label: "Right Side" },
];

const problemOptions = [
  "Visible Damage",
  "Transportation Damage",
  "Missing Parts",
  "Missing Wheel/Tire",
  "Broken Glass",
  "Condition mismatch",
  "Wrong Vehicle",
  "Other",
];

export function VehicleReceiving({ user }: { user: User }) {
  const { vehicles, receiveVehicle } = useVehicleData();
  const [step, setStep] = useState<Step>("scan");
  const [vinInput, setVinInput] = useState("");
  const [matched, setMatched] = useState<VehicleRecord | null>(null);
  const [photos, setPhotos] = useState<Record<string, boolean>>({});
  const [extraPhotoCount, setExtraPhotoCount] = useState(0);
  const [vinProblems, setVinProblems] = useState(0);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState(problemOptions[0]);
  const [problemNote, setProblemNote] = useState("");
  const [lastArrival, setLastArrival] = useState<{ vehicle: VehicleRecord; at: string } | null>(null);

  const inbound = useMemo(
    () => vehicles.filter((v) => !v.closedReason && v.receivingStatus === "not_received" && (v.transportStatus === "ASSIGNED" || v.transportStatus === "IN_TRANSIT")),
    [vehicles]
  );
  const today = new Date().toISOString().slice(0, 10);
  const arrivedToday = useMemo(() => vehicles.filter((v) => v.receivedAt?.slice(0, 10) === today).length, [vehicles, today]);

  function resetToScan() {
    setStep("scan");
    setVinInput("");
    setMatched(null);
    setPhotos({});
    setExtraPhotoCount(0);
  }

  function lookupVin(vin: string) {
    const clean = vin.trim();
    if (!clean) return;
    const found = vehicles.find((v) => v.vin.toLowerCase() === clean.toLowerCase());
    if (!found) {
      setVinProblems((n) => n + 1);
      setStep("nomatch");
      return;
    }
    setMatched(found);
    if (found.receivingStatus === "received") {
      setStep("already");
    } else {
      setStep("match");
    }
  }

  function simulateScan() {
    const candidate = inbound[0];
    if (!candidate) {
      toast.info("No inbound vehicles waiting to be scanned in this demo.");
      return;
    }
    setVinInput(candidate.vin);
    lookupVin(candidate.vin);
  }

  const allRequiredCaptured = requiredPhotoSlots.every((s) => photos[s.id]);

  function confirmArrival() {
    if (!matched) return;
    const arrivalPhotos = [
      ...requiredPhotoSlots.filter((s) => photos[s.id]).map((s) => ({ id: s.id, label: s.label, takenAt: new Date().toISOString() })),
      ...Array.from({ length: extraPhotoCount }, (_, i) => ({ id: `extra-${i}`, label: "Additional photo", takenAt: new Date().toISOString() })),
    ];
    receiveVehicle(matched.id, { receivedBy: user.name, photos: arrivalPhotos });
    setLastArrival({ vehicle: matched, at: new Date().toISOString() });
    setStep("success");
  }

  function submitProblem() {
    toast.success(`${problemType} logged for this vehicle (mock — routed to manager review)`);
    setProblemOpen(false);
    setProblemNote("");
    setProblemType(problemOptions[0]);
  }

  return (
    <div className="space-y-5">
      <div className="-mx-4 -mt-6 flex flex-wrap items-center justify-between gap-3 bg-brand px-4 py-5 text-brand-foreground sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-foreground/10">
            <CarFront className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold">Vehicle Arrival</h2>
            <p className="text-sm text-brand-foreground/70">Scan VIN · Verify · Take Photos · Confirm Arrival</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-brand-foreground/80">
          <UserRound className="size-4" /> {user.name}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <button onClick={resetToScan} className="min-w-0 rounded-lg border border-primary/20 bg-primary/6 p-3.5 text-left">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <CarFront className="size-4" />
          </span>
          <b className="mt-2 block text-2xl font-bold text-primary tabular-nums">{inbound.length}</b>
          <span className="block text-xs font-semibold">Expected Today</span>
        </button>
        <div className="min-w-0 rounded-lg border border-success/20 bg-success/8 p-3.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-success/15 text-success">
            <CheckCircle2 className="size-4" />
          </span>
          <b className="mt-2 block text-2xl font-bold text-success tabular-nums">{arrivedToday}</b>
          <span className="block text-xs font-semibold">Arrived Today</span>
        </div>
        <div className="min-w-0 rounded-lg border border-warning/25 bg-warning/10 p-3.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-warning/20 text-warning-foreground">
            <Clock3 className="size-4" />
          </span>
          <b className="mt-2 block text-2xl font-bold text-warning-foreground tabular-nums">{inbound.length}</b>
          <span className="block text-xs font-semibold">Still Waiting</span>
        </div>
        <div className="min-w-0 rounded-lg border border-destructive/20 bg-destructive/8 p-3.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-destructive/15 text-destructive">
            <TriangleAlert className="size-4" />
          </span>
          <b className="mt-2 block text-2xl font-bold text-destructive tabular-nums">{vinProblems}</b>
          <span className="block text-xs font-semibold">VIN Problems</span>
        </div>
      </div>

      {step === "scan" && (
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
            <h3 className="text-base font-semibold">Scan VIN</h3>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">Scan the VIN barcode or take a photo</p>
          <button
            onClick={simulateScan}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 py-8 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            <ScanLine className="size-9" />
            <span className="text-sm font-semibold">Tap to Scan VIN</span>
          </button>
          <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="secondary" className="w-full" onClick={simulateScan}>
            <Camera className="size-4" /> Take Photo of VIN
          </Button>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="vin-manual">Enter VIN Manually (if needed)</Label>
            <div className="flex gap-1.5">
              <Input
                id="vin-manual"
                placeholder="17-character VIN"
                value={vinInput}
                onChange={(e) => setVinInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupVin(vinInput)}
              />
              <Button variant="outline" disabled={!vinInput.trim()} onClick={() => lookupVin(vinInput)}>
                <Search className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "match" && matched && (
        <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-xs font-bold text-success-foreground">2</span>
            <div>
              <h3 className="text-base font-semibold">Match Found</h3>
              <p className="text-xs text-muted-foreground">Vehicle found in Auction Inventory</p>
            </div>
          </div>
          <div className="rounded-lg border border-success/30 bg-success/8 p-3.5">
            <div className="mb-2.5 flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" />
              <b className="text-sm">MATCH FOUND</b>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">VIN</span>
              <span className="text-right font-medium">{matched.vin}</span>
              <span className="text-muted-foreground">Stock / Lot #</span>
              <span className="text-right font-medium">{matched.stockNumber || matched.lotNumber || "—"}</span>
              <span className="text-muted-foreground">Year</span>
              <span className="text-right font-medium">{matched.year}</span>
              <span className="text-muted-foreground">Make</span>
              <span className="text-right font-medium">{matched.make}</span>
              <span className="text-muted-foreground">Model</span>
              <span className="text-right font-medium">{matched.model}</span>
              <span className="text-muted-foreground">Auction</span>
              <span className="text-right font-medium">{matched.auctionSource}</span>
              <span className="text-muted-foreground">Purchase Date</span>
              <span className="text-right font-medium">{matched.saleDate}</span>
              <span className="text-muted-foreground">Transporter</span>
              <span className="text-right font-medium">{matched.carrierName || "Not Assigned"}</span>
              <span className="text-muted-foreground">Current Status</span>
              <span className="text-right">
                <StatusBadge tone="warning">{transportStatusLabels[matched.transportStatus]}</StatusBadge>
              </span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="flex-1" onClick={() => setStep("photos")}>
              Continue to Photos
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setProblemOpen(true)}>
              <TriangleAlert className="size-4" /> Report Problem
            </Button>
          </div>
        </div>
      )}

      {step === "already" && matched && (
        <div className="mx-auto max-w-lg rounded-lg border border-warning/30 bg-warning/10 p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2 text-warning-foreground">
            <TriangleAlert className="size-5" />
            <h3 className="text-base font-semibold">Vehicle Already Received</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-background p-3 text-sm">
            <span className="text-muted-foreground">Original arrival</span>
            <span className="text-right font-medium">{matched.receivedAt ? new Date(matched.receivedAt).toLocaleString() : "—"}</span>
            <span className="text-muted-foreground">Received by</span>
            <span className="text-right font-medium">{matched.receivedBy || "—"}</span>
            <span className="text-muted-foreground">Current status</span>
            <span className="text-right font-medium">{matched.status}</span>
          </div>
          <Button className="mt-4 w-full" variant="outline" onClick={resetToScan}>
            <ScanLine className="size-4" /> Scan Next Vehicle
          </Button>
        </div>
      )}

      {step === "nomatch" && (
        <div className="mx-auto max-w-lg rounded-lg border border-destructive/30 bg-card p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-5" />
            <div>
              <h3 className="text-base font-semibold">No Match Found</h3>
              <p className="text-xs text-muted-foreground">This VIN was not found in Auction Inventory.</p>
            </div>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
            <b className="block text-lg font-bold text-destructive">VIN NOT MATCHED</b>
            <p className="text-sm font-semibold text-destructive">DO NOT ACCEPT THIS VEHICLE</p>
          </div>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            This VIN does not match any vehicle in our purchase records.
          </p>
          <div className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                toast.info("Manager notified for review (mock)");
              }}
            >
              <UserRound className="size-4" /> Send to Manager for Review
            </Button>
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              Do not accept or offload this vehicle until a manager has reviewed it.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="flex-1" onClick={resetToScan}>
              Rescan VIN
            </Button>
            <Button variant="outline" className="flex-1" onClick={resetToScan}>
              Enter VIN Manually
            </Button>
          </div>
        </div>
      )}

      {step === "photos" && matched && (
        <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
            <div>
              <h3 className="text-base font-semibold">Take Arrival Photos</h3>
              <p className="text-xs text-muted-foreground">Take clear photos of the vehicle (required)</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {requiredPhotoSlots.map((slot) => (
              <label
                key={slot.id}
                className="relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
              >
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={() => setPhotos((p) => ({ ...p, [slot.id]: true }))}
                />
                <Camera className="size-6" />
                <span className="text-xs font-medium">{slot.label}</span>
                {photos[slot.id] && (
                  <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-success text-success-foreground">
                    <CheckCircle2 className="size-3.5" />
                  </span>
                )}
              </label>
            ))}
          </div>
          <label className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5">
            <Plus className="size-4" /> Add More Photos (Optional)
            <input type="file" accept="image/*" className="hidden" onChange={() => setExtraPhotoCount((n) => n + 1)} />
          </label>
          {extraPhotoCount > 0 && <p className="mt-1.5 text-center text-xs text-muted-foreground">{extraPhotoCount} additional photo(s) added</p>}
          <Button className="mt-4 w-full" disabled={!allRequiredCaptured} onClick={() => setStep("confirm")}>
            Continue to Confirm Arrival
          </Button>
        </div>
      )}

      {step === "confirm" && matched && (
        <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
            <div>
              <h3 className="text-base font-semibold">Confirm Arrival</h3>
              <p className="text-xs text-muted-foreground">Verify the information and confirm this vehicle has arrived.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">VIN</span>
            <span className="text-right font-medium">{matched.vin}</span>
            <span className="text-muted-foreground">Stock / Lot #</span>
            <span className="text-right font-medium">{matched.stockNumber || matched.lotNumber || "—"}</span>
            <span className="text-muted-foreground">Vehicle</span>
            <span className="text-right font-medium">
              {matched.year} {matched.make} {matched.model}
            </span>
            <span className="text-muted-foreground">Transporter</span>
            <span className="text-right font-medium">{matched.carrierName || "Not Assigned"}</span>
          </div>
          <div className="mt-3 rounded-md border border-border p-3">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Arrival Details</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Arrived By</span>
              <span className="text-right font-medium">{user.name} (You)</span>
              <span className="text-muted-foreground">Arrival Date &amp; Time</span>
              <span className="text-right font-medium">{new Date().toLocaleString()}</span>
            </div>
          </div>
          <Button className="mt-4 w-full bg-success text-success-foreground hover:bg-success/90" size="lg" onClick={confirmArrival}>
            <CheckCircle2 className="size-4" /> Confirm Arrival
          </Button>
        </div>
      )}

      {step === "success" && lastArrival && (
        <div className="mx-auto max-w-lg rounded-lg border border-success/30 bg-success/8 p-5 text-center shadow-xs">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success text-success-foreground">
            <CheckCircle2 className="size-7" />
          </span>
          <h3 className="mt-3 text-lg font-bold text-success">Vehicle Successfully Checked In!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The vehicle has been added to inventory and is now marked as Available in Yard.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-background p-3 text-left text-sm">
            <span className="text-muted-foreground">VIN</span>
            <span className="text-right font-medium">{lastArrival.vehicle.vin}</span>
            <span className="text-muted-foreground">Stock / Lot #</span>
            <span className="text-right font-medium">{lastArrival.vehicle.stockNumber || lastArrival.vehicle.lotNumber || "—"}</span>
            <span className="text-muted-foreground">Vehicle</span>
            <span className="text-right font-medium">
              {lastArrival.vehicle.year} {lastArrival.vehicle.make} {lastArrival.vehicle.model}
            </span>
            <span className="text-muted-foreground">Arrival Date</span>
            <span className="text-right font-medium">{new Date(lastArrival.at).toLocaleString()}</span>
            <span className="text-muted-foreground">Arrived By</span>
            <span className="text-right font-medium">{user.name}</span>
          </div>
          <Button className="mt-4 w-full" size="lg" onClick={resetToScan}>
            <ScanLine className="size-4" /> Scan Next Vehicle
          </Button>
        </div>
      )}

      <Dialog open={problemOpen} onOpenChange={setProblemOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Report a Problem</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Problem type</Label>
              <Select value={problemType} onValueChange={(v) => setProblemType(v ?? problemOptions[0])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {problemOptions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea value={problemNote} onChange={(e) => setProblemNote(e.target.value)} rows={3} placeholder="Optional details" />
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-primary">
              <Camera className="size-3.5" /> Add evidence photo (optional)
              <input type="file" accept="image/*" className="hidden" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProblemOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitProblem}>
              Log Problem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
