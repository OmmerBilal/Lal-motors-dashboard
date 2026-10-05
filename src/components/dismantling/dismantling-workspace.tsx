"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CircleCheckBig, Flag, PencilLine, Play, RefreshCw, Trash2, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaCapture, usePersistedPhoto } from "@/components/media/media-capture";
import { useEffectiveUser } from "@/lib/effective-user";
import type { User } from "@/lib/types";
import { ISSUE_TYPES, findMyDismantlingAssignment, type EmployeeAssignmentRow, type EmployeeWorkspace, type WorkspacePart } from "@/lib/data/dismantling-v2";
import { useEmployeeMutations, useMyAssignments, useMyWorkspace } from "@/lib/query/dismantling-v2";

const NAME_MIN = 2, NAME_MAX = 120, DETAILS_MIN = 3, DETAILS_MAX = 500;

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "The change was not saved. Nothing was changed.";
}

const vehicleLine = (v: { year: number; make: string; model: string }) => `${v.year} ${v.make} ${v.model}`;
const shortTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");

/**
 * Dismantling Employee App. Assignment-driven: an employee sees only the vehicles assigned to them, and every
 * change is made by a database RPC that checks the assignment. Owner, manager and engineer admin see a read-only
 * preview with no way to perform employee work.
 */
export function DismantlingWorkspace({ user }: { user: User }) {
  const { realUser } = useEffectiveUser();
  const isEmployee = realUser.role === "dismantling";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The open vehicle lives in the URL, so a reload or tab return resumes the same work from the server.
  const assignmentId = searchParams.get("assignment");
  const setAssignmentId = (id: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set("assignment", id);
    else next.delete("assignment");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (!isEmployee) {
    return (
      <div className="space-y-5 pb-10">
        <div role="status" className="rounded-xl border-2 border-warning bg-warning/15 p-4">
          <p className="text-sm font-bold tracking-wide text-warning-foreground uppercase">Employee app preview — read only</p>
          <p className="mt-1 text-sm">Sign in as the assigned dismantling employee to perform dismantling work. {user.name}, this screen does not change any employee work.</p>
        </div>
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Employee assignments and captures are not shown in this preview. Review dismantling work in Vehicle Dismantling Processing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="-mx-4 -mt-6 bg-brand px-4 py-4 text-brand-foreground sm:-mx-6 sm:px-6">
        <p className="text-[11px] font-bold tracking-[0.14em] text-brand-foreground/60 uppercase">Dismantling</p>
        <h2 className="text-xl font-bold sm:text-2xl">{assignmentId ? "Vehicle Dismantling" : "My Assigned Vehicles"}</h2>
      </div>
      {assignmentId ? (
        <AssignmentWork key={assignmentId} assignmentId={assignmentId} onBack={() => setAssignmentId(null)} />
      ) : (
        <EmployeeHome onOpen={setAssignmentId} />
      )}
    </div>
  );
}

function EmployeeHome({ onOpen }: { onOpen: (id: string) => void }) {
  const mine = useMyAssignments();
  const [tab, setTab] = useState<"assigned" | "in_progress" | "completed">("assigned");
  const [term, setTerm] = useState("");
  const [notAssigned, setNotAssigned] = useState(false);
  const queryClient = useQueryClient();

  const rows = (mine.data ?? []) as EmployeeAssignmentRow[];
  const shown = rows.filter((r) => (tab === "assigned" ? r.assignment_status === "ASSIGNED" : tab === "in_progress" ? r.assignment_status === "IN_PROGRESS" : r.assignment_status === "COMPLETED"));
  const counts = {
    assigned: rows.filter((r) => r.assignment_status === "ASSIGNED").length,
    in_progress: rows.filter((r) => r.assignment_status === "IN_PROGRESS").length,
    completed: rows.filter((r) => r.assignment_status === "COMPLETED").length,
  };

  async function search() {
    const clean = term.trim();
    if (clean.length < 3) return;
    try {
      const res = await findMyDismantlingAssignment(clean);
      if (res.result === "found" && res.assignment_id) {
        setNotAssigned(false);
        onOpen(res.assignment_id);
      } else if (res.result === "not_assigned") {
        setNotAssigned(true);
      } else {
        setNotAssigned(false);
        toast.info("No vehicle matches that VIN, lot or stock number.");
      }
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <div className="space-y-4">
      <>
          <div className="grid grid-cols-3 gap-2">
            {(["assigned", "in_progress", "completed"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-xl border p-3 text-left ${tab === key ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                aria-pressed={tab === key}
              >
                <span className="block text-2xl font-extrabold tabular-nums">{counts[key]}</span>
                <span className="block text-xs font-semibold">{key === "assigned" ? "Assigned" : key === "in_progress" ? "In Progress" : "Completed"}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assigned-search">Find an assigned vehicle (VIN, lot or stock #)</Label>
            <div className="flex gap-2">
              <Input id="assigned-search" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="VIN, lot or stock number" className="h-11" />
              <Button variant="outline" className="h-11" onClick={search} disabled={term.trim().length < 3}>Find</Button>
            </div>
            {notAssigned && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">This vehicle is not assigned to you.</p>
            )}
          </div>
        </>

      <>
          {mine.isPending && <p className="text-sm text-muted-foreground">Loading your vehicles…</p>}
          {mine.isError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Your vehicles could not be loaded. <button className="underline" onClick={() => queryClient.invalidateQueries({ queryKey: ["dismantling-v2", "mine"] })}>Try again</button>
            </p>
          )}
          {!mine.isPending && shown.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {tab === "assigned" ? "No vehicles are assigned to you right now." : tab === "in_progress" ? "No dismantling is in progress." : "No completed vehicles yet."}
            </p>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {shown.map((r) => (
              <li key={r.assignment_id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold leading-tight break-words">{vehicleLine(r)}</p>
                    <p className="mt-1 font-mono text-xs break-all">VIN {r.vin ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Lot {r.lot_number ?? "—"} · Stock {r.stock_number ?? "—"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Assigned {shortTime(r.assigned_at)}{r.started_at ? ` · Started ${shortTime(r.started_at)}` : ""}</p>
                  </div>
                  {r.issues_flagged > 0 && <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-xs font-bold text-warning-foreground">Issue</span>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{r.parts_captured} part(s) captured</span>
                  <Button
                    className="h-11 min-w-32"
                    variant={r.assignment_status === "COMPLETED" ? "outline" : "default"}
                    onClick={() => onOpen(r.assignment_id)}
                  >
                    {r.assignment_status === "ASSIGNED" ? (<><Play className="size-4" /> Start Dismantling</>) : r.assignment_status === "IN_PROGRESS" ? (<><RefreshCw className="size-4" /> Resume Dismantling</>) : "View Completed"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
      </>
    </div>
  );
}

function AssignmentWork({ assignmentId, onBack }: { assignmentId: string; onBack: () => void }) {
  const { realUser } = useEffectiveUser();
  const workspace = useMyWorkspace(assignmentId);
  const m = useEmployeeMutations(assignmentId);
  const readOnly = realUser.role !== "dismantling";

  if (workspace.isPending) return <p className="text-sm text-muted-foreground">Opening vehicle…</p>;
  if (workspace.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorText(workspace.error)}</p>
        <Button variant="outline" className="h-11" onClick={onBack}><ArrowLeft className="size-4" /> Back to My Assigned Vehicles</Button>
      </div>
    );
  }
  const ws = workspace.data as EmployeeWorkspace;
  const started = ws.assignment.status === "IN_PROGRESS" && !!ws.session;
  const completed = ws.assignment.status === "COMPLETED";

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex h-11 items-center gap-2 text-sm font-semibold text-primary">
        <ArrowLeft className="size-4" /> Back to My Assigned Vehicles
      </button>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-lg font-bold break-words">{vehicleLine(ws.vehicle)}</h3>
        <p className="mt-1 font-mono text-xs break-all">VIN {ws.vehicle.vin ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Lot {ws.vehicle.lot_number ?? "—"} · Stock {ws.vehicle.stock_number ?? "—"} · {ws.vehicle.auction_source}</p>
        <p className="mt-2 text-sm font-semibold">Status: {ws.assignment.status === "ASSIGNED" ? "Assigned" : ws.assignment.status === "IN_PROGRESS" ? "In progress" : "Completed"}</p>
        {ws.assignment.status === "ASSIGNED" && !readOnly && (
          <Button className="mt-3 h-12 w-full text-base" disabled={m.start.isPending} onClick={() => m.start.mutate(undefined, { onError: (e) => toast.error(errorText(e)) })}>
            <Play className="size-5" /> {m.start.isPending ? "Starting…" : "Start Dismantling"}
          </Button>
        )}
      </section>

      {completed && <CompletionSummary ws={ws} />}

      {started && !completed && (
        <>
          <EvidenceSection ws={ws} readOnly={readOnly} onSaved={() => m.refresh()} />
          <CaptureSection ws={ws} readOnly={readOnly} m={m} />
          <CapturedParts ws={ws} readOnly={readOnly} m={m} />
          {!readOnly && <IssueSection ws={ws} m={m} />}
          {!readOnly && <FinishSection ws={ws} m={m} onDone={() => m.refresh()} />}
        </>
      )}
    </div>
  );
}

function EvidenceSection({ ws, readOnly, onSaved }: { ws: EmployeeWorkspace; readOnly: boolean; onSaved: () => void }) {
  const [extra, setExtra] = useState(0);
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h4 className="font-bold">Vehicle Evidence</h4>
        <p className="text-xs text-muted-foreground">At least one saved vehicle photo is required before Finish Vehicle. {ws.evidence_asset_ids.length} saved.</p>
      </div>
      {!readOnly && ws.session && (
        <div className="max-w-sm">
          <MediaCapture
            key={`evidence-${ws.session.id}-${extra}`}
            label={ws.evidence_asset_ids.length > 0 ? "Add another evidence photo" : "Vehicle evidence photo"}
            ownerType="dismantling_session"
            ownerId={ws.session.id}
            role="vehicle_evidence"
            onUploaded={() => { setExtra((n) => n + 1); onSaved(); }}
          />
        </div>
      )}
    </section>
  );
}

function CaptureSection({ ws, readOnly, m }: { ws: EmployeeWorkspace; readOnly: boolean; m: ReturnType<typeof useEmployeeMutations> }) {
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [pendingPartId, setPendingPartId] = useState<string | null>(null);
  const sessionId = ws.session?.id ?? "";
  const pendingPart = ws.parts.find((p) => p.id === pendingPartId) ?? null;

  const validName = name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX;
  const validDetails = details.trim().length >= DETAILS_MIN && details.trim().length <= DETAILS_MAX;

  async function startCapture() {
    try {
      const res = await m.beginPart.mutateAsync({ sessionId, name: name.trim(), details: details.trim() });
      setPendingPartId(res.part_id);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function savePartAndNext() {
    if (!pendingPartId) return;
    try {
      await m.savePart.mutateAsync(pendingPartId);
      setPendingPartId(null);
      setName("");
      setDetails("");
      toast.success("Part saved. Ready for the next part.");
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  if (readOnly) return null;

  return (
    <section className="space-y-3 rounded-xl border-2 border-primary/25 bg-card p-4">
      <h4 className="font-bold">Capture Part</h4>
      {!pendingPart ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="capture-name">Part Name <span className="text-destructive">*</span></Label>
            <Input id="capture-name" className="h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder="e.g. Front Left Headlight" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capture-details">Part Details / Notes <span className="text-destructive">*</span></Label>
            <Textarea id="capture-details" className="min-h-24 text-base" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={DETAILS_MAX} placeholder="e.g. OEM headlight, lens intact, mounting tab damaged" />
          </div>
          <Button className="h-12 w-full text-base" disabled={!validName || !validDetails || m.beginPart.isPending} onClick={startCapture}>
            <Wrench className="size-5" /> {m.beginPart.isPending ? "Saving…" : "Add this part"}
          </Button>
          <p className="text-xs text-muted-foreground">Next: take or choose a photo of this part, then Save Part &amp; Next.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-md bg-warning/20 px-3 py-2 text-sm font-semibold text-warning-foreground">Part “{pendingPart.capture_name}” is not saved yet. Add its photo, then Save Part &amp; Next.</p>
          <MediaCapture
            key={`part-${pendingPart.id}`}
            label="Part photo"
            ownerType="part"
            ownerId={pendingPart.id}
            role="capture"
            persistedMediaId={pendingPart.photo_asset_ids[0] ?? null}
            onUploaded={() => m.refresh()}
          />
          <Button className="h-12 w-full text-base" disabled={pendingPart.photo_asset_ids.length === 0 && !pendingPart.capture_saved_at} onClick={savePartAndNext}>
            <CircleCheckBig className="size-5" /> Save Part &amp; Next
          </Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => m.abandonPart.mutate(pendingPart.id, { onSuccess: () => setPendingPartId(null), onError: (e) => toast.error(errorText(e)) })}>
            <Trash2 className="size-4" /> Cancel this part
          </Button>
        </div>
      )}
      {!validName && name.length > 0 && <p className="text-xs text-destructive">Part name needs 2 to 120 characters.</p>}
      {!validDetails && details.length > 0 && <p className="text-xs text-destructive">Part details need 3 to 500 characters.</p>}
      <p className="text-xs text-muted-foreground">Warehouse, SKU, price and listing details are added later by management. Do not enter them here.</p>
    </section>
  );
}

function CapturedParts({ ws, readOnly, m }: { ws: EmployeeWorkspace; readOnly: boolean; m: ReturnType<typeof useEmployeeMutations> }) {
  const [editing, setEditing] = useState<WorkspacePart | null>(null);
  const [editName, setEditName] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const saved = ws.parts.filter((p) => p.capture_saved_at);
  if (ws.parts.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No parts captured from this vehicle yet.</p>;
  }
  return (
    <section className="space-y-3">
      <h4 className="font-bold">Parts Captured From This Vehicle ({saved.length} saved)</h4>
      <ul className="grid gap-3 sm:grid-cols-2">
        {ws.parts.map((p) => (
          <CapturedPartCard key={p.id} part={p} readOnly={readOnly || ws.assignment.status !== "IN_PROGRESS"} onEdit={() => { setEditing(p); setEditName(p.capture_name); setEditDetails(p.capture_details); }} />
        ))}
      </ul>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Correct part capture</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input className="h-12 text-base" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={NAME_MAX} aria-label="Part Name" />
              <Textarea className="min-h-24 text-base" value={editDetails} onChange={(e) => setEditDetails(e.target.value)} maxLength={DETAILS_MAX} aria-label="Part Details / Notes" />
            </div>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 w-full" disabled={m.updatePart.isPending} onClick={() => m.updatePart.mutate({ partId: editing.id, name: editName.trim(), details: editDetails.trim() }, { onSuccess: () => { setEditing(null); toast.success("Capture updated."); }, onError: (e) => toast.error(errorText(e)) })}>Save changes</Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => setEditing(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function CapturedPartCard({ part, readOnly, onEdit }: { part: WorkspacePart; readOnly: boolean; onEdit: () => void }) {
  const photo = usePersistedPhoto(part.photo_asset_ids[0] ?? null);
  const isSaved = !!part.capture_saved_at;
  return (
    <li className="flex min-w-0 gap-3 rounded-xl border border-border bg-card p-3">
      <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {photo.data ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.data} alt={`${part.capture_name} photo`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">{part.photo_asset_ids.length ? "Loading" : "No photo"}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="min-w-0 font-semibold leading-tight break-words">{part.capture_name}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${isSaved ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}>{isSaved ? "✓ Saved" : "NOT SAVED"}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground break-words">{part.capture_details}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Captured {shortTime(part.captured_at)}</p>
        {!readOnly && isSaved && (
          <button onClick={onEdit} className="mt-1 flex h-9 items-center gap-1 text-xs font-semibold text-primary"><PencilLine className="size-3.5" /> Correct</button>
        )}
      </div>
    </li>
  );
}

function IssueSection({ ws, m }: { ws: EmployeeWorkspace; m: ReturnType<typeof useEmployeeMutations> }) {
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<string>(ISSUE_TYPES[0]);
  const [note, setNote] = useState("");
  if (!ws.session) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-bold">Report an Issue (Optional)</h4>
          <p className="text-xs text-muted-foreground">Use only when something is wrong: vehicle mismatch, unexpected damage, a missing component, an unsafe condition, or a record discrepancy. Not needed for a normal vehicle.</p>
        </div>
        <Button variant="outline" className="h-11" onClick={() => setOpen(true)}><Flag className="size-4" /> Report an issue</Button>
      </div>
      {ws.issues.length > 0 && <p className="mt-2 text-xs text-warning-foreground">{ws.issues.length} issue(s) reported on this vehicle.</p>}
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Report an issue (optional)</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Issue type</Label>
                <Select value={issue} onValueChange={(v) => v && setIssue(v)}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issue-note">What is wrong? (at least 5 characters)</Label>
                <Textarea id="issue-note" className="min-h-24" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 w-full" disabled={note.trim().length < 5 || m.flagIssue.isPending}
                onClick={() => m.flagIssue.mutate({ sessionId: ws.session!.id, issue, note: note.trim() }, { onSuccess: () => { setOpen(false); setNote(""); toast.success("Issue reported."); }, onError: (e) => toast.error(errorText(e)) })}>
                Submit issue
              </Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(false)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function FinishSection({ ws, m, onDone }: { ws: EmployeeWorkspace; m: ReturnType<typeof useEmployeeMutations>; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const unsaved = ws.parts.filter((p) => !p.capture_saved_at).length;
  const hasEvidence = ws.evidence_asset_ids.length > 0;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <Button className="h-14 w-full text-lg" disabled={!ws.session || m.finish.isPending}
        onClick={() => ws.session && m.finish.mutate(ws.session.id, { onSuccess: () => { setError(null); onDone(); toast.success("Vehicle dismantling completed."); }, onError: (e) => setError(errorText(e)) })}>
        <CircleCheckBig className="size-5" /> {m.finish.isPending ? "Finishing…" : "Finish Vehicle"}
      </Button>
      {(!hasEvidence || unsaved > 0) && (
        <p className="text-xs text-muted-foreground">
          {!hasEvidence && "Add at least one vehicle evidence photo. "}
          {unsaved > 0 && `${unsaved} captured part(s) are not saved yet.`}
        </p>
      )}
      {error && <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</p>}
    </section>
  );
}

function CompletionSummary({ ws }: { ws: EmployeeWorkspace }) {
  return (
    <section className="space-y-3 rounded-xl border border-success/40 bg-success/10 p-4">
      <h4 className="font-bold text-success">Vehicle Dismantling Completed</h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Vehicle</dt><dd className="text-right font-medium break-words">{vehicleLine(ws.vehicle)}</dd>
        <dt className="text-muted-foreground">Parts captured</dt><dd className="text-right font-medium">{ws.parts.length}</dd>
        <dt className="text-muted-foreground">Issues</dt><dd className="text-right font-medium">{ws.issues.length}</dd>
        <dt className="text-muted-foreground">Started</dt><dd className="text-right font-medium">{shortTime(ws.assignment.started_at)}</dd>
        <dt className="text-muted-foreground">Finished</dt><dd className="text-right font-medium">{shortTime(ws.assignment.completed_at)}</dd>
      </dl>
    </section>
  );
}
