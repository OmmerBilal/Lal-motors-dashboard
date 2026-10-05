import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Barcode,
  Camera,
  CarFront,
  CheckCircle2,
  CircleCheck,
  Flag,
  LogOut,
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
import { toVehicleRecord } from "@/lib/data/vehicle-record";
import { MediaCapture } from "@/components/media/media-capture";
import { PartCaptureSlot } from "@/components/dismantling/part-capture-slot";
import {
  DISMANTLING_ISSUE_TYPES,
  DismantlingError,
  countSessionEvidence,
  finishDismantlingSession,
  flagDismantlingIssue,
  listSavedSessionParts,
  lookupForDismantling,
  resumeMyDismantlingSession,
  startDismantlingSession,
  type DismantlingIssueType,
} from "@/lib/data/dismantling";

type Phase = "home" | "find" | "notfound" | "alreadyDismantled" | "alreadyInProcess" | "confirm" | "session" | "processing" | "completed";

/** "full" = Vehicle Dismantling (evidence photos, then part photos). "quick" = Quick Part Capture. */
type Mode = "full" | "quick";

type PartPhoto = { id: string; takenAt: string };

type QuickCapture = { id: string; partType: string; takenAt: string };

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
  const { signOut: endSession } = useSession();

  const [phase, setPhase] = useState<Phase>("home");
  const [mode, setMode] = useState<Mode>("full");
  const [searchInput, setSearchInput] = useState("");
  const [foundVehicle, setFoundVehicle] = useState<VehicleRecord | null>(null);
  const [inProcessInfo, setInProcessInfo] = useState<{ employee: string; startTime: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionVehicle, setSessionVehicle] = useState<VehicleRecord | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string>("");
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [partPhotos, setPartPhotos] = useState<PartPhoto[]>([]);
  const [capturing, setCapturing] = useState(false);
  // Quick Part Capture shows the same saved parts as the vehicle session, newest first. Nothing is kept only in the browser.
  const quickCaptures: QuickCapture[] = partPhotos
    .map((p, i) => ({ id: p.id, partType: "Part " + (partPhotos.length - i), takenAt: p.takenAt }))
    .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1));
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueType, setIssueType] = useState<DismantlingIssueType>(DISMANTLING_ISSUE_TYPES[0]);
  const [issueNote, setIssueNote] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const issueRequestRef = useRef<string>(crypto.randomUUID());

  // Resume the employee's own open session after a reload or a restart.
  useEffect(() => {
    let alive = true;
    resumeMyDismantlingSession(user.id)
      .then(async (resumed) => {
        if (!alive || !resumed) return;
        const [evidence, saved] = await Promise.all([countSessionEvidence(resumed.sessionId), listSavedSessionParts(resumed.sessionId)]);
        if (!alive) return;
        setSessionId(resumed.sessionId);
        setSessionVehicle(toVehicleRecord(resumed.vehicle));
        setSessionStartedAt(resumed.startedAt);
        setEvidenceCount(evidence);
        setPartPhotos(saved.map((p) => ({ id: p.id, takenAt: p.takenAt })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user.id]);

  function resetToFind() {
    setPhase("find");
    setMode("full");
    setSearchInput("");
    setFoundVehicle(null);
    setInProcessInfo(null);
    setSessionId(null);
    setSessionVehicle(null);
    setSessionStartedAt("");
    setEvidenceCount(0);
    setPartPhotos([]);
    setCapturing(false);
    setFinishConfirmOpen(false);
    setSubmitting(false);
    setCompletedSummary(null);
  }

  /** Home menu actions reuse the open session instead of forcing a new scan. */
  function goToVehicleDismantling() {
    setMode("full");
    setPhase(sessionVehicle ? "session" : "find");
  }

  function goToQuickCapture() {
    setMode("quick");
    setPhase(sessionVehicle ? "session" : "find");
  }

  async function openMySession() {
    const resumed = await resumeMyDismantlingSession(user.id);
    if (!resumed) {
      toast.error("Your session could not be opened. Try again.");
      return;
    }
    const [evidence, saved] = await Promise.all([countSessionEvidence(resumed.sessionId), listSavedSessionParts(resumed.sessionId)]);
    setSessionId(resumed.sessionId);
    setSessionVehicle(toVehicleRecord(resumed.vehicle));
    setSessionStartedAt(resumed.startedAt);
    setEvidenceCount(evidence);
    setPartPhotos(saved.map((p) => ({ id: p.id, takenAt: p.takenAt })));
    setPhase("session");
  }

  async function lookupVehicle(raw: string) {
    const q = raw.trim();
    if (!q) return;
    try {
      const result = await lookupForDismantling(q, user.id);
      if (result.status === "not_found") {
        setFoundVehicle(null);
        setPhase("notfound");
        return;
      }
      const record = toVehicleRecord(result.vehicle);
      setFoundVehicle(record);
      if (result.status === "dismantled") {
        setPhase("alreadyDismantled");
        return;
      }
      if (result.status === "in_process") {
        if (result.mine) {
          await openMySession();
          return;
        }
        setInProcessInfo({ employee: "Another employee", startTime: new Date(result.startedAt).toLocaleString() });
        setPhase("alreadyInProcess");
        return;
      }
      setPhase("confirm");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The lookup failed. Try again.");
    }
  }


  async function startDismantling() {
    if (!foundVehicle) return;
    setSubmitting(true);
    try {
      const r = await startDismantlingSession(foundVehicle.id);
      setSessionId(r.session_id);
      setSessionVehicle({ ...foundVehicle, status: "Processing", assignedId: user.id, assignedName: user.name });
      setSessionStartedAt(new Date().toISOString());
      setEvidenceCount(0);
      setPartPhotos([]);
        setPhase("session");
    } catch (err) {
      if (err instanceof DismantlingError && err.hint === "ALREADY_IN_PROCESS") {
        setInProcessInfo({ employee: "Another employee", startTime: new Date().toLocaleString() });
        setPhase("alreadyInProcess");
        return;
      }
      if (err instanceof DismantlingError && err.hint === "ALREADY_DISMANTLED") {
        setPhase("alreadyDismantled");
        return;
      }
      toast.error(err instanceof Error ? err.message : "The session could not be started. Nothing was saved.");
    } finally {
      setSubmitting(false);
    }
  }

  function startCapture() {
    setCapturing(true);
  }

  function fullPartSaved(partId: string) {
    setPartPhotos((xs) => [...xs, { id: partId, takenAt: new Date().toISOString() }]);
    setCapturing(false);
    toast.success("Part photo saved");
  }

  function quickPartSaved(partId: string) {
    setPartPhotos((xs) => [...xs, { id: partId, takenAt: new Date().toISOString() }]);
    setCapturing(false);
    toast.success("Part saved to this vehicle");
  }

  // Saved photos are part of the record. Removing one is a manager decision during review.
  function removePartPhoto(id: string) {
    void id;
    toast.info("Saved part photos stay on the record. A manager can reject a part during review.");
  }

  async function runProcessing() {
    if (!sessionId || !sessionVehicle) return;
    setSubmitting(true);
    setPhase("processing");
    try {
      const r = await finishDismantlingSession(sessionId);
      setCompletedSummary({
        vehicle: sessionVehicle,
        photosSaved: partPhotos.length,
        partsProcessed: r.part_photos_captured,
        needsReview: r.part_photos_captured,
      });
      setPhase("completed");
    } catch (err) {
      setPhase("session");
      if (err instanceof DismantlingError && err.hint === "NO_EVIDENCE") {
        toast.error("Add at least one vehicle evidence photo before finishing.");
      } else if (err instanceof DismantlingError && err.hint === "PART_WITHOUT_PHOTO") {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "The vehicle could not be finished. Nothing was changed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitIssue() {
    if (!sessionId) {
      toast.error("Issues are recorded during an active dismantling session. Nothing was saved.");
      return;
    }
    if (issueNote.trim().length < 5) {
      toast.error("Describe the issue in at least 5 characters.");
      return;
    }
    setIssueBusy(true);
    try {
      await flagDismantlingIssue({ sessionId, issue: issueType, note: issueNote.trim(), requestId: issueRequestRef.current });
      issueRequestRef.current = crypto.randomUUID();
      toast.success("Issue flagged for manager review");
      setIssueOpen(false);
      setIssueType(DISMANTLING_ISSUE_TYPES[0]);
      setIssueNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The issue was not saved. Try again.");
    } finally {
      setIssueBusy(false);
    }
  }

  function logOut() {
    void endSession();
  }

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
                disabled
                title="Scanning is not connected. Type the number below."
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-4 text-muted-foreground opacity-70"
              >
                <ScanLine className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan VIN (not connected)</span>
              </button>
              <button
                disabled
                title="Scanning is not connected. Type the number below."
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-4 text-muted-foreground opacity-70"
              >
                <Barcode className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan Lot # (not connected)</span>
              </button>
              <button
                disabled
                title="Scanning is not connected. Type the number below."
                className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-4 text-muted-foreground opacity-70"
              >
                <Barcode className="size-6" />
                <span className="text-xs font-bold sm:text-sm">Scan Stock # (not connected)</span>
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
              <Button variant="outline" className="h-12" onClick={() => manualInputRef.current?.focus()}>
                <ScanLine className="size-4" /> Type VIN, Lot or Stock instead
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

            <p className="mt-4 text-sm text-muted-foreground">Starting creates your session. Vehicle evidence photos are added next.</p>
            <PrimaryButton className="mt-3" onClick={startDismantling} disabled={submitting}>

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
              <div className="mb-4">
                <MediaCapture
                  label="Vehicle evidence photo (required)"
                  ownerType="dismantling_session"
                  ownerId={sessionId ?? ""}
                  role="vehicle_evidence"
                  onUploaded={() => setEvidenceCount((n) => n + 1)}
                />
                <p className="mt-2 text-xs text-muted-foreground">{evidenceCount > 0 ? evidenceCount + " evidence photo(s) saved" : "At least one is required before you finish."}</p>
              </div>
              <h3 className="text-lg font-bold">Take Part Photos</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">Photograph every useful part. No labeling needed.</p>

              {capturing && sessionId ? (
                <PartCaptureSlot
                  sessionId={sessionId}
                  label="Part photo"
                  onSaved={fullPartSaved}
                  onDiscard={() => setCapturing(false)}
                />
              ) : (
                <button
                  onClick={startCapture}
                  disabled={!sessionId}
                  className="relative mt-4 flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
                >
                  {partPhotos.length > 0 && (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-brand-foreground shadow-sm">
                      {partPhotos.length} photo{partPhotos.length === 1 ? "" : "s"} saved
                    </span>
                  )}
                  {partPhotos.length > 0 ? <Wrench className="size-14 opacity-60" /> : <Camera className="size-12" />}
                  <span className="text-sm font-bold">{partPhotos.length > 0 ? "Take Another Part Photo" : "Tap to Take Photo"}</span>
                </button>
              )}

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
                </div>
              )}
            </div>

            <Button variant="outline" className="h-12 w-full text-destructive" onClick={() => setIssueOpen(true)}>
              <Flag className="size-4" /> Flag Issue
            </Button>

            <PrimaryButton disabled={evidenceCount === 0 || partPhotos.length === 0 || submitting} onClick={() => setFinishConfirmOpen(true)}>
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

              {capturing && sessionId ? (
                <div className="mt-4">
                  <PartCaptureSlot
                    sessionId={sessionId}
                    label="Part photo"
                    onSaved={quickPartSaved}
                    onDiscard={() => setCapturing(false)}
                  />
                </div>
              ) : (
                <button
                  onClick={startCapture}
                  disabled={!sessionId}
                  className="mt-4 flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/70 disabled:opacity-50"
                >
                  <Camera className="size-12" />
                  <span className="text-sm font-bold">{quickCaptures.length > 0 ? "Save & Next: Take Next Part Photo" : "Take Part Photo"}</span>
                </button>
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
              <Wrench className="size-7" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Finishing vehicle…</h3>
            <p className="mt-2 text-xs text-muted-foreground">Checking the photos and saving. Please wait.</p>
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
              <Field label="Parts Captured" value={completedSummary.partsProcessed} />
              <Field label="Sent to Manager Review" value={completedSummary.needsReview} />
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
              <Select value={issueType} onValueChange={(v) => setIssueType((v as DismantlingIssueType) ?? DISMANTLING_ISSUE_TYPES[0])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISMANTLING_ISSUE_TYPES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (required, 5+ characters)</Label>
              <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={3} placeholder="Short note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={issueBusy || issueNote.trim().length < 5} onClick={submitIssue}>
              <Send className="size-4" /> Save Issue &amp; Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
