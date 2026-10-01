"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Camera,
  CarFront,
  CircleCheckBig,
  Clock3,
  ScanLine,
  Search,
  Send,
  TriangleAlert,
  Truck,
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </>
  );
}

function CardShell({
  tone,
  badge,
  title,
  subtitle,
  children,
}: {
  tone: "blue" | "green" | "red" | "neutral";
  badge: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const toneBorder = {
    blue: "border-primary/25",
    green: "border-success/30",
    red: "border-destructive/30",
    neutral: "border-border",
  }[tone];

  return (
    <div className={`flex h-full flex-col rounded-xl border ${toneBorder} bg-card p-4 shadow-xs`}>
      <div className="mb-3 flex items-center gap-2.5">
        {badge}
        <div className="min-w-0">
          <h3 className="text-base font-bold">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumberBadge({ n, tone }: { n: number; tone: "blue" | "green" }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
        tone === "green" ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"
      }`}
    >
      {n}
    </span>
  );
}

function Placeholder({ icon: Icon, text }: { icon: typeof CarFront; text: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-muted-foreground">
      <Icon className="size-8 opacity-40" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

export function VehicleReceiving({ user }: { user: User }) {
  const { vehicles, receiveVehicle } = useVehicleData();
  const [vinInput, setVinInput] = useState("");
  const [matched, setMatched] = useState<VehicleRecord | null>(null);
  const [alreadyReceived, setAlreadyReceived] = useState<VehicleRecord | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [photos, setPhotos] = useState<Record<string, boolean>>({});
  const [extraPhotoCount, setExtraPhotoCount] = useState(0);
  const [vinProblems, setVinProblems] = useState(0);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState(problemOptions[0]);
  const [problemNote, setProblemNote] = useState("");
  const [confirmed, setConfirmed] = useState<{ vehicle: VehicleRecord; at: string } | null>(null);

  const now = useMemo(() => new Date(), []);

  const inbound = useMemo(
    () =>
      vehicles.filter(
        (v) => !v.closedReason && v.receivingStatus === "not_received" && (v.transportStatus === "ASSIGNED" || v.transportStatus === "IN_TRANSIT")
      ),
    [vehicles]
  );
  const today = now.toISOString().slice(0, 10);
  const arrivedToday = useMemo(() => vehicles.filter((v) => v.receivedAt?.slice(0, 10) === today).length, [vehicles, today]);

  function resetAll() {
    setVinInput("");
    setMatched(null);
    setAlreadyReceived(null);
    setNoMatch(false);
    setPhotos({});
    setExtraPhotoCount(0);
    setConfirmed(null);
  }

  function lookupVin(vin: string) {
    const clean = vin.trim();
    if (!clean) return;
    const found = vehicles.find((v) => v.vin.toLowerCase() === clean.toLowerCase());
    setConfirmed(null);
    setPhotos({});
    setExtraPhotoCount(0);

    if (!found) {
      setMatched(null);
      setAlreadyReceived(null);
      setNoMatch(true);
      setVinProblems((n) => n + 1);
      return;
    }
    setNoMatch(false);
    if (found.receivingStatus === "received") {
      setAlreadyReceived(found);
      setMatched(null);
    } else {
      setMatched(found);
      setAlreadyReceived(null);
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
    setConfirmed({ vehicle: matched, at: new Date().toISOString() });
  }

  function submitProblem() {
    toast.success(`${problemType} logged for this vehicle (mock — routed to manager review)`);
    setProblemOpen(false);
    setProblemNote("");
    setProblemType(problemOptions[0]);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="-mx-4 -mt-6 flex flex-wrap items-center justify-between gap-3 bg-brand px-4 py-4 text-brand-foreground sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-foreground/10">
            <CarFront className="size-7" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold sm:text-2xl">Vehicle Arrival</h2>
            <p className="text-sm text-brand-foreground/70">Scan VIN · Verify · Take Photos · Confirm Arrival</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-sm text-brand-foreground/85">
          <span className="hidden sm:inline">
            {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
            {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-foreground/10 py-1 pr-3 pl-1.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-foreground/15">
              <UserRound className="size-3.5" />
            </span>
            {user.name}
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          onClick={resetAll}
          className="flex min-w-0 items-center justify-between rounded-xl border border-primary/25 bg-primary/8 p-4 text-left transition-colors hover:bg-primary/12"
        >
          <span>
            <b className="block text-3xl font-extrabold text-primary tabular-nums">{inbound.length}</b>
            <span className="block text-sm font-semibold">Expected Today</span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Truck className="size-6" />
          </span>
        </button>
        <div className="flex min-w-0 items-center justify-between rounded-xl border border-success/25 bg-success/10 p-4">
          <span>
            <b className="block text-3xl font-extrabold text-success tabular-nums">{arrivedToday}</b>
            <span className="block text-sm font-semibold">Arrived Today</span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
            <CircleCheckBig className="size-6" />
          </span>
        </div>
        <button
          onClick={resetAll}
          className="flex min-w-0 items-center justify-between rounded-xl border border-warning/30 bg-warning/15 p-4 text-left transition-colors hover:bg-warning/20"
        >
          <span>
            <b className="block text-3xl font-extrabold text-warning-foreground tabular-nums">{inbound.length}</b>
            <span className="block text-sm font-semibold">Still Waiting</span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
            <Clock3 className="size-6" />
          </span>
        </button>
        <div className="flex min-w-0 items-center justify-between rounded-xl border border-destructive/25 bg-destructive/10 p-4">
          <span>
            <b className="block text-3xl font-extrabold text-destructive tabular-nums">{vinProblems}</b>
            <span className="block text-sm font-semibold">VIN Problems</span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive text-white">
            <TriangleAlert className="size-6" />
          </span>
        </div>
      </div>

      {/* 3-column workflow grid — always 6 cards, state decides active vs placeholder */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* 1. Scan VIN — always active */}
        <CardShell tone="blue" badge={<NumberBadge n={1} tone="blue" />} title="Scan VIN" subtitle="Scan the VIN barcode or take a photo">
          <button
            onClick={simulateScan}
            className="flex w-full flex-col items-center gap-2 rounded-lg bg-muted py-7 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-primary"
          >
            <ScanLine className="size-10" />
            <span className="text-sm font-semibold">Tap to Scan VIN</span>
          </button>
          <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> OR <span className="h-px flex-1 bg-border" />
          </div>
          <Button className="w-full bg-brand text-brand-foreground hover:bg-brand/90" onClick={simulateScan}>
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
              <Button variant="outline" disabled={!vinInput.trim()} onClick={() => lookupVin(vinInput)} aria-label="Search VIN">
                <Search className="size-4" />
              </Button>
            </div>
          </div>
        </CardShell>

        {/* 2. Match Found / Already Received / placeholder */}
        {matched ? (
          <CardShell tone="green" badge={<NumberBadge n={2} tone="green" />} title="Match Found" subtitle="Vehicle found in Auction Inventory">
            <div className="rounded-lg border border-success/30 bg-success/10 p-3.5">
              <div className="mb-2.5 flex items-center gap-2 text-success">
                <CircleCheckBig className="size-5" />
                <b className="text-sm">MATCH FOUND</b>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <InfoRow label="VIN" value={matched.vin} />
                <InfoRow label="Stock / Lot #" value={matched.stockNumber || matched.lotNumber || "—"} />
                <InfoRow label="Year" value={matched.year} />
                <InfoRow label="Make" value={matched.make} />
                <InfoRow label="Model" value={matched.model} />
                <InfoRow label="Auction" value={matched.auctionSource} />
                <InfoRow label="Purchase Date" value={matched.saleDate} />
                <InfoRow label="Transporter" value={matched.carrierName || "Not Assigned"} />
                <InfoRow label="Current Status" value={<StatusBadge tone="warning">{transportStatusLabels[matched.transportStatus]}</StatusBadge>} />
              </div>
            </div>
            <Button variant="outline" className="mt-3 w-full text-destructive" onClick={() => setProblemOpen(true)}>
              <TriangleAlert className="size-4" /> Report Problem
            </Button>
          </CardShell>
        ) : alreadyReceived ? (
          <CardShell tone="blue" badge={<TriangleAlert className="size-7 shrink-0 text-warning" />} title="Already Received" subtitle="This vehicle was already checked in">
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-sm">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <InfoRow label="Vehicle" value={`${alreadyReceived.year} ${alreadyReceived.make} ${alreadyReceived.model}`} />
                <InfoRow label="Original Arrival" value={alreadyReceived.receivedAt ? new Date(alreadyReceived.receivedAt).toLocaleString() : "—"} />
                <InfoRow label="Received By" value={alreadyReceived.receivedBy || "—"} />
                <InfoRow label="Current Status" value={alreadyReceived.status} />
              </div>
            </div>
          </CardShell>
        ) : (
          <CardShell tone="neutral" badge={<NumberBadge n={2} tone="blue" />} title="Match Found" subtitle="Vehicle found in Auction Inventory">
            <Placeholder icon={CircleCheckBig} text="Scan a VIN to see vehicle match details here." />
          </CardShell>
        )}

        {/* 3. Take Arrival Photos / placeholder */}
        {matched ? (
          <CardShell tone="blue" badge={<NumberBadge n={3} tone="blue" />} title="Take Arrival Photos" subtitle="Take clear photos of the vehicle (required)">
            <div className="grid grid-cols-2 gap-3">
              {requiredPhotoSlots.map((slot) => (
                <label
                  key={slot.id}
                  className={`relative flex aspect-video cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border text-center transition-colors ${
                    photos[slot.id] ? "border-success/40 bg-success/10 text-success" : "border-dashed border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={() => setPhotos((p) => ({ ...p, [slot.id]: true }))} />
                  <CarFront className="size-7" />
                  <span className="text-xs font-medium">{slot.label}</span>
                  {photos[slot.id] && (
                    <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-success text-success-foreground">
                      <CircleCheckBig className="size-3.5" />
                    </span>
                  )}
                </label>
              ))}
            </div>
            <label className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5">
              <Camera className="size-4" /> Add More Photos (Optional)
              <input type="file" accept="image/*" className="hidden" onChange={() => setExtraPhotoCount((n) => n + 1)} />
            </label>
            {extraPhotoCount > 0 && <p className="mt-1.5 text-center text-xs text-muted-foreground">{extraPhotoCount} additional photo(s) added</p>}
          </CardShell>
        ) : (
          <CardShell tone="neutral" badge={<NumberBadge n={3} tone="blue" />} title="Take Arrival Photos" subtitle="Take clear photos of the vehicle (required)">
            <Placeholder icon={Camera} text="Complete Step 1 to unlock photo capture." />
          </CardShell>
        )}

        {/* 4. Confirm Arrival / placeholder */}
        {matched ? (
          <CardShell tone="blue" badge={<NumberBadge n={4} tone="blue" />} title="Confirm Arrival" subtitle="Verify the information and confirm this vehicle has arrived.">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <InfoRow label="VIN" value={matched.vin} />
              <InfoRow label="Stock / Lot #" value={matched.stockNumber || matched.lotNumber || "—"} />
              <InfoRow label="Vehicle" value={`${matched.year} ${matched.make} ${matched.model}`} />
              <InfoRow label="Auction" value={matched.auctionSource} />
              <InfoRow label="Transporter" value={matched.carrierName || "Not Assigned"} />
            </div>
            <div className="mt-3 rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Arrival Details</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <InfoRow label="Arrived By" value={`${user.name} (You)`} />
                <InfoRow label="Arrival Date & Time" value={new Date().toLocaleString()} />
              </div>
            </div>
            <Button
              className="mt-3 w-full bg-success text-success-foreground hover:bg-success/90"
              size="lg"
              disabled={!allRequiredCaptured || !!confirmed}
              onClick={confirmArrival}
            >
              <BadgeCheck className="size-4" /> {confirmed ? "Arrival Confirmed" : "Confirm Arrival"}
            </Button>
          </CardShell>
        ) : (
          <CardShell tone="neutral" badge={<NumberBadge n={4} tone="blue" />} title="Confirm Arrival" subtitle="Verify the information and confirm this vehicle has arrived.">
            <Placeholder icon={BadgeCheck} text="Finish the required photos to confirm arrival." />
          </CardShell>
        )}

        {/* 5. No Match Found / placeholder */}
        {noMatch ? (
          <CardShell tone="red" badge={<TriangleAlert className="size-7 shrink-0 text-destructive" />} title="No Match Found" subtitle="This VIN was not found in Auction Inventory.">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
              <b className="block text-lg font-bold text-destructive">VIN NOT MATCHED</b>
              <p className="text-sm font-semibold text-destructive">DO NOT ACCEPT THIS VEHICLE</p>
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">This VIN does not match any vehicle in our purchase records.</p>
            <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
              <div className="flex items-start gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <UserRound className="size-4" />
                </span>
                <div>
                  <b className="block text-sm text-destructive">Send to Manager for Review</b>
                  <p className="text-xs text-muted-foreground">Do not accept or offload this vehicle until a manager has reviewed it.</p>
                </div>
              </div>
              <Button variant="destructive" className="mt-3 w-full" onClick={() => toast.info("Manager notified for review (mock)")}>
                <Send className="size-4" /> Notify Manager
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => lookupVin(vinInput)}>
                Rescan VIN
              </Button>
              <Button variant="outline" size="sm" onClick={() => lookupVin(vinInput)}>
                Retake Photo
              </Button>
              <Button variant="outline" size="sm" onClick={resetAll}>
                Manual Entry
              </Button>
            </div>
          </CardShell>
        ) : (
          <CardShell tone="neutral" badge={<TriangleAlert className="size-7 shrink-0 text-muted-foreground/40" />} title="No Match Found" subtitle="This VIN was not found in Auction Inventory.">
            <Placeholder icon={TriangleAlert} text="No VIN problems on this scan." />
          </CardShell>
        )}

        {/* 6. Arrival Confirmed / placeholder */}
        {confirmed ? (
          <CardShell tone="green" badge={<CircleCheckBig className="size-7 shrink-0 text-success" />} title="Arrival Confirmed" subtitle="Vehicle successfully checked in">
            <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success text-success-foreground">
                <CircleCheckBig className="size-6" />
              </span>
              <h4 className="mt-2 text-base font-bold text-success">Vehicle Successfully Checked In!</h4>
              <p className="mt-1 text-xs text-muted-foreground">The vehicle has been added to inventory and is now marked as Available in Yard.</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-muted/30 p-3 text-sm">
              <InfoRow label="VIN" value={confirmed.vehicle.vin} />
              <InfoRow label="Stock / Lot #" value={confirmed.vehicle.stockNumber || confirmed.vehicle.lotNumber || "—"} />
              <InfoRow label="Vehicle" value={`${confirmed.vehicle.year} ${confirmed.vehicle.make} ${confirmed.vehicle.model}`} />
              <InfoRow label="Arrival Date" value={new Date(confirmed.at).toLocaleString()} />
              <InfoRow label="Arrived By" value={user.name} />
            </div>
            <Button className="mt-3 w-full" size="lg" onClick={resetAll}>
              <ScanLine className="size-4" /> Scan Next Vehicle
            </Button>
          </CardShell>
        ) : (
          <CardShell tone="neutral" badge={<CircleCheckBig className="size-7 shrink-0 text-muted-foreground/40" />} title="Arrival Confirmed" subtitle="Vehicle successfully checked in">
            <Placeholder icon={ScanLine} text="Confirm arrival to see the success summary here." />
          </CardShell>
        )}
      </div>

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
