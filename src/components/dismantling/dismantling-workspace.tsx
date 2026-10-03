"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Barcode,
  Camera,
  CarFront,
  CheckCircle2,
  CircleCheck,
  CloudOff,
  Flag,
  LogOut,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Send,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { User } from "@/lib/types";
import { useSession } from "@/lib/session";
import type { VehicleRecord } from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import {
  guessPartType,
  guessReviewStatus,
  highValuePartTypes,
  issueOptions,
  processingChecklist,
  type ProcessedPartResult,
} from "@/lib/mock/dismantling";

type Phase = "home" | "find" | "notfound" | "alreadyDismantled" | "alreadyInProcess" | "confirm" | "session" | "processing" | "uploadFailed" | "completed";

/** "full" = the approved Vehicle Dismantling flow (unchanged). "quick" = Quick Part Capture —
 * same shared vehicle/session, but each part photo is saved and linked to the current
 * donor vehicle immediately instead of being batched until the vehicle is finished. */
type Mode = "full" | "quick";

type PartPhoto = { id: string; takenAt: string };

type QuickCapture = { id: string; partType: string; reviewStatus: ReturnType<typeof guessReviewStatus>; takenAt: string };

type CompletedSummary = {
  vehicle: VehicleRecord;
  photosSaved: number;
  partsProcessed: number;
  needsReview: number;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function PrimaryButton({ className = "", ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={`h-14 w-full bg-accent-gold text-base font-bold text-accent-gold-foreground shadow-sm hover:bg-accent-gold/90 ${className}`}
    />
  );
}

export function DismantlingWorkspace({ user }: { user: User }) {
  const router = useRouter();
  const { setUserId, users } = useSession();
  const { vehicles, updateVehicle, recordEvent, vehicleEvents } = useVehicleData();

  const [phase, setPhase] = useState<Phase>("home");
  const [mode, setMode] = useState<Mode>("full");
  const [searchInput, setSearchInput] = useState("");
  const [foundVehicle, setFoundVehicle] = useState<VehicleRecord | null>(null);
  const [vehiclePhotoTaken, setVehiclePhotoTaken] = useState(false);

  const [sessionVehicle, setSessionVehicle] = useState<VehicleRecord | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string>("");
  const [partPhotos, setPartPhotos] = useState<PartPhoto[]>([]);

  const [quickCaptures, setQuickCaptures] = useState<QuickCapture[]>([]);
  const [quickPendingPhoto, setQuickPendingPhoto] = useState(false);
  const quickCaptureIndexRef = useRef(0);

  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const failedOnceRef = useRef(false);
  const [checklistStep, setChecklistStep] = useState(0);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueType, setIssueType] = useState(issueOptions[0]);
  const [issueNote, setIssueNote] = useState("");
  const [issuePhoto, setIssuePhoto] = useState(false);

  const manualInputRef = useRef<HTMLInputElement>(null);

  function resetToFind() {
    setPhase("find");
    setMode("full");
    setSearchInput("");
    setFoundVehicle(null);
    setVehiclePhotoTaken(false);
    setSessionVehicle(null);
    setSessionStartedAt("");
    setPartPhotos([]);
    setFinishConfirmOpen(false);
    setSubmitting(false);
    failedOnceRef.current = false;
    setChecklistStep(0);
    setCompletedSummary(null);
    setQuickCaptures([]);
    setQuickPendingPhoto(false);
    quickCaptureIndexRef.current = 0;
  }

  /** Home menu actions — reuse the active session automatically if one is already open
   * (per spec: never force a re-scan when a dismantling session is already in progress). */
  function goToVehicleDismantling() {
    setMode("full");
    setPhase(sessionVehicle ? "session" : "find");
  }

  function goToQuickCapture() {
    setMode("quick");
    setPhase(sessionVehicle ? "session" : "find");
  }

  function lookupVehicle(raw: string) {
    const q = raw.trim();
    if (!q) return;
    const found = vehicles.find(
      (v) => v.vin.toLowerCase() === q.toLowerCase() || v.lotNumber.toLowerCase() === q.toLowerCase() || v.stockNumber.toLowerCase() === q.toLowerCase()
    );
    if (!found) {
      setFoundVehicle(null);
      setPhase("notfound");
      return;
    }
    if (found.status === "Dismantled") {
      setFoundVehicle(found);
      setPhase("alreadyDismantled");
      return;
    }
    if (found.status === "Processing") {
      setFoundVehicle(found);
      setPhase("alreadyInProcess");
      return;
    }
    setFoundVehicle(found);
    setVehiclePhotoTaken(false);
    setPhase("confirm");
  }

  function simulateScan(field: "vin" | "lot" | "stock") {
    const candidate = vehicles.find((v) => v.status === "Available at Yard") || vehicles.find((v) => !v.closedReason);
    if (!candidate) {
      toast.info("No vehicles available to scan in this demo.");
      return;
    }
    const value = field === "vin" ? candidate.vin : field === "lot" ? candidate.lotNumber : candidate.stockNumber;
    setSearchInput(value);
    lookupVehicle(value);
  }

  function startDismantling() {
    if (!foundVehicle) return;
    updateVehicle(foundVehicle.id, { status: "Processing", assignedId: user.id, assignedName: user.name });
    recordEvent({
      vehicleId: foundVehicle.id,
      action: "START",
      actorId: user.id,
      note: "Dismantling started",
      hasPhoto: vehiclePhotoTaken,
    });
    setSessionVehicle({ ...foundVehicle, status: "Processing", assignedId: user.id, assignedName: user.name });
    setSessionStartedAt(new Date().toISOString());
    setPartPhotos([]);
    failedOnceRef.current = false;
    setPhase("session");
  }

  function addPartPhoto() {
    setPartPhotos((xs) => [...xs, { id: `part-${Date.now()}-${xs.length}`, takenAt: new Date().toISOString() }]);
  }

  function removePartPhoto(id: string) {
    setPartPhotos((xs) => xs.filter((p) => p.id !== id));
  }

  /** Quick Part Capture: no typing, no part ID/SKU/pricing from the employee — just a
   * photo, saved and linked to the current donor vehicle/session immediately (AI/manager
   * review organizes it later, same as the approved flow). */
  function onPickQuickPhoto() {
    setQuickPendingPhoto(true);
  }

  function saveQuickCapture() {
    if (!sessionVehicle) return;
    const index = quickCaptureIndexRef.current++;
    const partType = guessPartType(index);
    const reviewStatus = guessReviewStatus(index);
    const partId = `qpc-${sessionVehicle.id}-${Date.now()}-${index}`;

    recordEvent({
      vehicleId: sessionVehicle.id,
      action: "PART_REMOVED",
      actorId: user.id,
      partType,
      highValue: reviewStatus !== "processed" || highValuePartTypes.has(partType),
      disposition:
        reviewStatus === "possible_duplicate" ? "POSSIBLE DUPLICATE — MANAGER REVIEW" : reviewStatus === "processed" ? "IN INVENTORY" : undefined,
      hasPhoto: true,
      partId,
    });

    setQuickCaptures((xs) => [{ id: partId, partType, reviewStatus, takenAt: new Date().toISOString() }, ...xs]);
    setQuickPendingPhoto(false);
    toast.success(`${partType} captured · linked to ${sessionVehicle.year} ${sessionVehicle.make} ${sessionVehicle.model}`);
  }

  function runProcessing() {
    setSubmitting(true);
    setPhase("processing");
    setChecklistStep(0);

    let step = 0;
    const tick = () => {
      step += 1;
      setChecklistStep(step);
      if (step < processingChecklist.length) {
        window.setTimeout(tick, 450);
        return;
      }
      window.setTimeout(finishProcessing, 500);
    };
    window.setTimeout(tick, 450);
  }

  function finishProcessing() {
    if (!sessionVehicle) return;

    if (!failedOnceRef.current) {
      failedOnceRef.current = true;
      setSubmitting(false);
      setPhase("uploadFailed");
      return;
    }

    const results: ProcessedPartResult[] = partPhotos.map((p, i) => ({
      id: p.id,
      partType: guessPartType(i),
      reviewStatus: guessReviewStatus(i),
      capturedAt: p.takenAt,
    }));

    results.forEach((r) => {
      const needsReview = r.reviewStatus !== "processed";
      recordEvent({
        vehicleId: sessionVehicle.id,
        action: "PART_REMOVED",
        actorId: user.id,
        partType: r.partType,
        highValue: needsReview || highValuePartTypes.has(r.partType),
        disposition: r.reviewStatus === "possible_duplicate" ? "POSSIBLE DUPLICATE — MANAGER REVIEW" : r.reviewStatus === "processed" ? "IN INVENTORY" : undefined,
        hasPhoto: true,
        partId: r.id,
      });
    });

    updateVehicle(sessionVehicle.id, { status: "Dismantled" });
    recordEvent({
      vehicleId: sessionVehicle.id,
      action: "STATUS",
      status: "Dismantled",
      actorId: user.id,
      note: `Dismantling completed — ${partPhotos.length + quickCaptures.length} part photo(s) captured`,
    });

    // Quick Part Captures already recorded their own PART_REMOVED events as they happened —
    // fold their counts into the summary so it reflects everything captured this session.
    setCompletedSummary({
      vehicle: sessionVehicle,
      photosSaved: partPhotos.length + quickCaptures.length,
      partsProcessed:
        results.filter((r) => r.reviewStatus === "processed").length +
        quickCaptures.filter((c) => c.reviewStatus === "processed").length,
      needsReview:
        results.filter((r) => r.reviewStatus !== "processed").length +
        quickCaptures.filter((c) => c.reviewStatus !== "processed").length,
    });
    setSubmitting(false);
    setPhase("completed");
  }

  function retryUpload() {
    runProcessing();
  }

  function submitIssue() {
    const vehicleId = sessionVehicle?.id || foundVehicle?.id;
    if (vehicleId) {
      recordEvent({
        vehicleId,
        action: "ISSUE_FLAGGED",
        actorId: user.id,
        note: `${issueType}${issueNote ? ` — ${issueNote}` : ""}`,
        hasPhoto: issuePhoto,
      });
    }
    toast.success("Issue flagged for manager review (mock)");
    setIssueOpen(false);
    setIssueType(issueOptions[0]);
    setIssueNote("");
    setIssuePhoto(false);
  }

  function logOut() {
    setUserId(users[0].id);
    router.push("/login");
  }

  const inProcessInfo = (() => {
    if (phase !== "alreadyInProcess" || !foundVehicle) return null;
    const events = vehicleEvents(foundVehicle.id);
    const started = events.find((e) => e.action === "START");
    return {
      employee: started?.actorName || foundVehicle.assignedName || "Unknown employee",
      startTime: started ? new Date(started.createdAt).toLocaleString() : "Unknown",
    };
  })();

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="-mx-4 -mt-6 border-b-4 border-accent-gold bg-brand px-4 py-4 text-brand-foreground sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-gold text-accent-gold-foreground">
              <Wrench className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.14em] text-brand-foreground/60 uppercase">LAL Motors</p>
              <h2 className="text-lg font-bold sm:text-xl">Dismantling Employee App</h2>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-brand-foreground/10 py-1 pr-3 pl-1 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-accent-gold text-xs font-bold text-accent-gold-foreground">
              {user.name.charAt(0)}
            </span>
            {user.name}
          </span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl space-y-4">
        {/* HOME: choose Vehicle Dismantling (full flow) or Quick Part Capture */}
        {phase === "home" && (
          <div className="space-y-3">
            {sessionVehicle && (
              <div className="flex items-center justify-between rounded-lg bg-brand/95 px-3.5 py-2.5 text-xs font-semibold text-brand-foreground">
                <span className="truncate">
                  Active session · {sessionVehicle.year} {sessionVehicle.make} {sessionVehicle.model} · {sessionVehicle.vin.slice(-6)}
                </span>
                <span className="shrink-0 rounded-full bg-accent-gold px-2 py-0.5 text-[11px] text-accent-gold-foreground">In Process</span>
              </div>
            )}

            <button
              onClick={goToVehicleDismantling}
              className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-5 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Wrench className="size-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold">Vehicle Dismantling</span>
                <span className="block text-sm text-muted-foreground">
                  {sessionVehicle ? "Resume the active session" : "Find a vehicle, take photos, finish it out"}
                </span>
              </span>
            </button>

            <button
              onClick={goToQuickCapture}
              className="flex w-full items-center gap-4 rounded-xl border border-accent-gold/40 bg-accent-gold/10 p-5 text-left shadow-xs transition-colors hover:bg-accent-gold/20"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-gold text-accent-gold-foreground">
                <Zap className="size-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold">Quick Part Capture</span>
                <span className="block text-sm text-muted-foreground">
                  {sessionVehicle ? "Keep capturing parts off this vehicle" : "Photo only — fast repeat capture"}
                </span>
              </span>
            </button>
          </div>
        )}

        {/* STEP 1: FIND VEHICLE */}
        {phase === "find" && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <h3 className="text-xl font-bold">Find Vehicle</h3>
            <p className="mt-1 text-sm text-muted-foreground">Scan or search to load a vehicle.</p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => simulateScan("vin")}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 py-4 text-primary transition-colors hover:bg-primary/15"
              >
                <ScanLine className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan VIN</span>
              </button>
              <button
                onClick={() => simulateScan("lot")}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 py-4 text-primary transition-colors hover:bg-primary/15"
              >
                <Barcode className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan Lot #</span>
              </button>
              <button
                onClick={() => simulateScan("stock")}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 py-4 text-primary transition-colors hover:bg-primary/15"
              >
                <Barcode className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan Stock #</span>
              </button>
            </div>

            <div className="mt-5 space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="manual-search">VIN / Lot # / Stock #</Label>
                <button
                  onClick={() => manualInputRef.current?.focus()}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <CarFront className="size-3.5" /> Or Enter Manually
                </button>
              </div>
              <Input
                id="manual-search"
                ref={manualInputRef}
                placeholder="Type or paste here"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupVehicle(searchInput)}
                className="h-12 text-base"
              />
            </div>
            <PrimaryButton className="mt-3" disabled={!searchInput.trim()} onClick={() => lookupVehicle(searchInput)}>
              <Search className="size-5" /> Find Vehicle
            </PrimaryButton>
          </div>
        )}

        {/* VEHICLE NOT FOUND */}
        {phase === "notfound" && (
          <div className="rounded-xl border border-destructive/30 bg-card p-5 text-center shadow-xs">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <TriangleAlert className="size-7" />
            </span>
            <h3 className="mt-3 text-xl font-bold text-destructive">VEHICLE NOT FOUND</h3>
            <p className="mt-1 text-sm text-muted-foreground">No vehicle matched that VIN, Lot # or Stock #.</p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <Button variant="outline" className="h-12" onClick={() => setPhase("find")}>
                Try Again
              </Button>
              <Button variant="outline" className="h-12" onClick={() => simulateScan("vin")}>
                <ScanLine className="size-4" /> Scan Again
              </Button>
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  setPhase("find");
                  window.setTimeout(() => manualInputRef.current?.focus(), 0);
                }}
              >
                Enter Manually
              </Button>
              <Button variant="outline" className="h-12 text-destructive" onClick={() => setIssueOpen(true)}>
                <Flag className="size-4" /> Flag Issue
              </Button>
            </div>
          </div>
        )}

        {/* VEHICLE ALREADY DISMANTLED */}
        {phase === "alreadyDismantled" && foundVehicle && (
          <div className="rounded-xl border border-border bg-card p-5 text-center shadow-xs">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CircleCheck className="size-7" />
            </span>
            <h3 className="mt-3 text-xl font-bold">VEHICLE ALREADY DISMANTLED</h3>
            <p className="mt-1 text-sm text-muted-foreground">This vehicle has already been completed.</p>
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-left">
              <Field label="Vehicle" value={`${foundVehicle.year} ${foundVehicle.make} ${foundVehicle.model}`} />
              <Field label="VIN" value={foundVehicle.vin} />
              <Field
                label="Status"
                value={<span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">Dismantled</span>}
              />
            </div>
            <PrimaryButton className="mt-4" onClick={resetToFind}>
              <ScanLine className="size-5" /> Scan Next Vehicle
            </PrimaryButton>
          </div>
        )}

        {/* VEHICLE ALREADY IN PROCESS */}
        {phase === "alreadyInProcess" && foundVehicle && (
          <div className="rounded-xl border border-warning/30 bg-card p-5 text-center shadow-xs">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning/20 text-warning-foreground">
              <TriangleAlert className="size-7" />
            </span>
            <h3 className="mt-3 text-xl font-bold text-warning-foreground">VEHICLE ALREADY IN PROCESS</h3>
            <p className="mt-1 text-sm text-muted-foreground">Another employee is currently dismantling this vehicle.</p>
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-left">
              <Field label="Vehicle" value={`${foundVehicle.year} ${foundVehicle.make} ${foundVehicle.model}`} />
              <Field label="Employee" value={inProcessInfo?.employee} />
              <Field label="Start Time" value={inProcessInfo?.startTime} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Button variant="outline" className="h-12" onClick={resetToFind}>
                Scan Next Vehicle
              </Button>
              <Button variant="outline" className="h-12 text-destructive" onClick={() => setIssueOpen(true)}>
                <Flag className="size-4" /> Flag Issue
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: VEHICLE FOUND / CONFIRM */}
        {phase === "confirm" && foundVehicle && (
          <div className="rounded-xl border border-success/30 bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2 text-success">
              <CircleCheck className="size-6" />
              <h3 className="text-xl font-bold">Vehicle Confirmed</h3>
            </div>

            <div className="mt-3 flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-success/10 text-success">
              <CarFront className="size-20" />
            </div>

            <div className="mt-3 space-y-0.5">
              <b className="block text-lg">
                {foundVehicle.year} {foundVehicle.make} {foundVehicle.model}
              </b>
              <p className="text-sm text-muted-foreground">VIN: {foundVehicle.vin}</p>
              <p className="text-sm text-muted-foreground">Stock #: {foundVehicle.stockNumber || foundVehicle.lotNumber || "—"}</p>
              <p className="text-sm text-muted-foreground">Location: {foundVehicle.location || "LAL Motors Yard"}</p>
            </div>

            {!vehiclePhotoTaken ? (
              <label className="mt-4 flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand text-base font-bold text-brand-foreground hover:bg-brand/90">
                <Camera className="size-5" /> Take Vehicle Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={() => setVehiclePhotoTaken(true)} />
              </label>
            ) : (
              <label className="mt-4 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50">
                <Camera className="size-4" /> Retake Vehicle Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={() => setVehiclePhotoTaken(true)} />
              </label>
            )}

            <PrimaryButton className="mt-3" disabled={!vehiclePhotoTaken} onClick={startDismantling}>
              {mode === "quick" ? "Start Quick Part Capture" : "Start Taking Part Photos"}
            </PrimaryButton>
            <Button variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={resetToFind}>
              Not the right vehicle? Scan again
            </Button>
          </div>
        )}

        {/* STEP 3: TAKE PART PHOTOS (active session, approved Vehicle Dismantling flow) */}
        {phase === "session" && sessionVehicle && mode === "full" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-brand/95 px-3.5 py-2.5 text-xs font-semibold text-brand-foreground">
              <span className="truncate">
                {sessionVehicle.year} {sessionVehicle.make} {sessionVehicle.model} · {sessionVehicle.vin.slice(-6)} · Started{" "}
                {sessionStartedAt ? new Date(sessionStartedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"}
              </span>
              <span className="shrink-0 rounded-full bg-accent-gold px-2 py-0.5 text-[11px] text-accent-gold-foreground">In Process</span>
            </div>

            <button
              onClick={() => setMode("quick")}
              className="flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-accent-gold-foreground hover:underline"
            >
              <Zap className="size-3.5" /> Switch to Quick Part Capture for this vehicle
            </button>

            <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
              <h3 className="text-lg font-bold">Take Part Photos</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">Photograph every useful part. No labeling needed.</p>

              <label className="relative mt-4 flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/70">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={addPartPhoto} />
                {partPhotos.length > 0 && (
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-brand-foreground shadow-sm">
                    {partPhotos.length} photo{partPhotos.length === 1 ? "" : "s"} saved
                  </span>
                )}
                {partPhotos.length > 0 ? <Wrench className="size-14 opacity-60" /> : <Camera className="size-12" />}
                <span className="text-sm font-bold">{partPhotos.length > 0 ? "Taking Photos..." : "Tap to Take Photo"}</span>
              </label>

              {partPhotos.length > 0 && (
                <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {partPhotos.map((p, i) => (
                    <div key={p.id} className="relative flex aspect-square items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                      <Wrench className="size-5" />
                      <span className="absolute bottom-1 left-1 text-[10px] font-semibold">{i + 1}</span>
                      <button
                        onClick={() => removePartPhoto(p.id)}
                        aria-label="Remove photo"
                        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow-sm"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-primary/40 bg-primary/5 text-primary hover:bg-primary/10">
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={addPartPhoto} />
                    <Plus className="size-4" />
                    <span className="text-[10px] font-bold">Add More</span>
                  </label>
                </div>
              )}
            </div>

            <Button variant="outline" className="h-12 w-full text-destructive" onClick={() => setIssueOpen(true)}>
              <Flag className="size-4" /> Flag Issue
            </Button>

            <PrimaryButton disabled={partPhotos.length === 0} onClick={() => setFinishConfirmOpen(true)}>
              Save &amp; Finish Vehicle
            </PrimaryButton>
          </div>
        )}

        {/* QUICK PART CAPTURE (active session) — photo only, no typing, each part saved and
            linked to the current donor vehicle the moment it's captured. No warehouse fields,
            no pricing, no SKU — that belongs to later Parts Inventory processing. */}
        {phase === "session" && sessionVehicle && mode === "quick" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-brand/95 px-3.5 py-2.5 text-xs font-semibold text-brand-foreground">
              <span className="truncate">
                Current Vehicle · {sessionVehicle.year} {sessionVehicle.make} {sessionVehicle.model} · VIN {sessionVehicle.vin.slice(-6)} · Stock/Lot{" "}
                {sessionVehicle.stockNumber || sessionVehicle.lotNumber || "—"}
              </span>
              <span className="shrink-0 rounded-full bg-accent-gold px-2 py-0.5 text-[11px] text-accent-gold-foreground">In Process</span>
            </div>

            <button
              onClick={() => setMode("full")}
              className="flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <Wrench className="size-3.5" /> Switch to Vehicle Dismantling for this vehicle
            </button>

            <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold">Quick Part Capture</h3>
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                  {quickCaptures.length} captured
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">Photo only. No typing. Each part saves instantly to this vehicle.</p>

              {!quickPendingPhoto ? (
                <label className="mt-4 flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/70">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickQuickPhoto} />
                  <Camera className="size-12" />
                  <span className="text-sm font-bold">Take Part Photo</span>
                </label>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-success/40 bg-success/5 text-success">
                    <CheckCircle2 className="size-10" />
                    <span className="text-sm font-bold">Photo ready</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/50">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickQuickPhoto} />
                      <RotateCcw className="size-4" /> Retake
                    </label>
                    <PrimaryButton className="h-12" onClick={saveQuickCapture}>
                      Save &amp; Next
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </div>

            {quickCaptures.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">Recent captures</p>
                <div className="space-y-1.5">
                  {quickCaptures.slice(0, 6).map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <Wrench className="size-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{c.partType}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(c.takenAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button variant="outline" className="h-12 w-full text-destructive" onClick={() => setIssueOpen(true)}>
              <Flag className="size-4" /> Flag Issue
            </Button>

            <Button variant="secondary" className="h-12 w-full" onClick={() => setPhase("home")}>
              Done — Back to Menu
            </Button>
          </div>
        )}

        {/* STEP 5: PROCESSING */}
        {phase === "processing" && (
          <div className="rounded-xl border border-border bg-card p-6 text-center shadow-xs">
            <span className="mx-auto flex size-16 animate-pulse items-center justify-center rounded-full bg-brand text-brand-foreground">
              <span className="text-xl font-extrabold tracking-tight">AI</span>
            </span>
            <h3 className="mt-3 text-lg font-bold">Processing Photos...</h3>
            <div className="mt-4 space-y-2 text-left">
              {processingChecklist.map((item, i) => (
                <div key={item} className={`flex items-center gap-2 text-sm ${i < checklistStep ? "text-foreground" : "text-muted-foreground/50"}`}>
                  {i < checklistStep ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <span className="size-4 shrink-0 rounded-full border border-current" />}
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success transition-all duration-500"
                style={{ width: `${(checklistStep / processingChecklist.length) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Please wait...</p>
          </div>
        )}

        {/* UPLOAD FAILED */}
        {phase === "uploadFailed" && sessionVehicle && (
          <div className="rounded-xl border border-destructive/30 bg-card p-5 text-center shadow-xs">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <CloudOff className="size-7" />
            </span>
            <h3 className="mt-3 text-lg font-bold text-destructive">UPLOAD NOT COMPLETE — RETRY</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connection was too weak to finish uploading. Your {partPhotos.length} photo(s) are saved on this device — nothing was lost.
            </p>
            <PrimaryButton className="mt-4" disabled={submitting} onClick={retryUpload}>
              <RotateCcw className="size-5" /> Retry Upload
            </PrimaryButton>
            <Button variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={() => setPhase("session")}>
              Back to Photos
            </Button>
          </div>
        )}

        {/* STEP 6: VEHICLE COMPLETED */}
        {phase === "completed" && completedSummary && (
          <div className="rounded-xl border border-success/30 bg-card p-5 text-center shadow-xs">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-success text-success-foreground">
              <CheckCircle2 className="size-8" />
            </span>
            <h3 className="mt-3 text-xl font-bold text-success">Vehicle Completed!</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">All photos saved and processed.</p>
            <div className="mt-4 rounded-lg bg-muted/40 p-3 text-left">
              <p className="mb-1.5 text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase">Summary</p>
              <Field label="Vehicle" value={`${completedSummary.vehicle.year} ${completedSummary.vehicle.make} ${completedSummary.vehicle.model}`} />
              <Field label="VIN" value={completedSummary.vehicle.vin} />
              <Field label="Photos Saved" value={completedSummary.photosSaved} />
              <Field label="Parts Processed" value={completedSummary.partsProcessed} />
              <Field label="Needs Review" value={completedSummary.needsReview} />
              <Field
                label="Status"
                value={
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-bold text-success">Dismantled</span>
                }
              />
            </div>
            <PrimaryButton className="mt-4" onClick={resetToFind}>
              <ScanLine className="size-5" /> Scan Next Vehicle
            </PrimaryButton>
            <Button variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={logOut}>
              <LogOut className="size-4" /> Log Out
            </Button>
          </div>
        )}
      </div>

      {/* Finish confirmation */}
      <Dialog open={finishConfirmOpen} onOpenChange={setFinishConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Finish this vehicle?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Finish this vehicle and submit all {partPhotos.length} photo(s)?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishConfirmOpen(false)}>
              Go Back
            </Button>
            <Button
              disabled={submitting}
              onClick={() => {
                setFinishConfirmOpen(false);
                runProcessing();
              }}
            >
              Finish Vehicle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flag issue */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Flag an Issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Issue type</Label>
              <Select value={issueType} onValueChange={(v) => setIssueType(v ?? issueOptions[0])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {issueOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={3} placeholder="Short note" />
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-primary">
              <Camera className="size-3.5" /> {issuePhoto ? "Photo attached" : "Add photo (optional)"}
              <input type="file" accept="image/*" className="hidden" onChange={() => setIssuePhoto(true)} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitIssue}>
              <Send className="size-4" /> Save Issue &amp; Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
