"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, UserRoundPlus, RotateCcw, Ban, Eye, CircleCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";
import type { User } from "@/lib/types";
import { usePersistedPhoto } from "@/components/media/media-capture";
import { AnalyzePartDialog } from "@/components/dismantling-processing/analyze-part-dialog";
import * as processing from "@/lib/data/processing";
import type { AdminVehicleRow, DismantlingTab, WorkloadRow } from "@/lib/data/dismantling-v2";
import { dismantlingKeys, useAdminVehicles, useAssignmentMutation, useVehicleRecord, useWorkload } from "@/lib/query/dismantling-v2";
import { useQueryClient } from "@tanstack/react-query";

const TABS: { key: DismantlingTab; label: string; hint: string }[] = [
  { key: "eligible", label: "Eligible / Not Ready", hint: "Received, open, not yet marked ready" },
  { key: "ready", label: "Ready to Dismantle", hint: "Marked ready, waiting for an assignment" },
  { key: "assigned", label: "Assigned", hint: "Assigned, work not started" },
  { key: "in_progress", label: "In Progress", hint: "An employee is dismantling now" },
  { key: "completed", label: "Completed", hint: "Dismantling finished" },
  { key: "issues", label: "Issues", hint: "Vehicles with an issue reported by an employee" },
];

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Nothing was changed. Try again.");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const dayTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** Manager vehicle workflow: Mark Ready, Assign Employee, Reassign or Cancel before start, and monitoring. */
export function VehicleWorkflow({ user, onOpenRecord }: { user: User; onOpenRecord: (vehicleId: string) => void }) {
  const [tab, setTab] = useState<DismantlingTab>("ready");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const list = useAdminVehicles(tab, search, page);
  const mut = useAssignmentMutation();
  const [dialog, setDialog] = useState<{ kind: "ready" | "assign" | "reassign" | "cancel" | "undo"; row: AdminVehicleRow } | null>(null);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pageSize = 50;
  const canEdit = user.role === "owner" || user.role === "manager" || user.role === "engineer_admin";

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-bold">Vehicle Workflow</h3>
        <p className="text-xs text-muted-foreground">Mark received vehicles ready, assign each to one dismantling employee, and follow the work through to review.</p>
      </div>

      <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            title={t.hint}
            onClick={() => { setTab(t.key); setPage(0); }}
            className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold", tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search VIN, lot, stock, make or model" className="h-10 max-w-md" aria-label="Search vehicles" />
        <span className="text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.hint} · {total} vehicle(s)</span>
      </div>

      {list.isPending && <p className="text-sm text-muted-foreground">Loading vehicles…</p>}
      {list.isError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorText(list.error)}</p>}
      {!list.isPending && rows.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No vehicles in this list.</p>}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <li key={r.vehicle_id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="font-bold leading-tight break-words">{r.year} {r.make} {r.model}</p>
              <p className="mt-0.5 font-mono text-xs break-all">VIN {r.vin ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Lot {r.lot_number ?? "—"} · Stock {r.stock_number ?? "—"} · {r.auction_source}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Received</dt><dd className="text-right">{day(r.received_at)}</dd>
              <dt className="text-muted-foreground">Ready</dt><dd className="text-right">{day(r.dismantling_ready_at)}</dd>
              {r.employee_name && (<><dt className="text-muted-foreground">Employee</dt><dd className="min-w-0 text-right font-medium break-words">{r.employee_name}</dd></>)}
              {r.assigned_by_name && (<><dt className="text-muted-foreground">Assigned by</dt><dd className="min-w-0 text-right break-words">{r.assigned_by_name}</dd></>)}
              {r.assigned_at && (<><dt className="text-muted-foreground">Assigned</dt><dd className="text-right">{dayTime(r.assigned_at)}</dd></>)}
              {r.started_at && (<><dt className="text-muted-foreground">Started</dt><dd className="text-right">{dayTime(r.started_at)}</dd></>)}
              {r.completed_at && (<><dt className="text-muted-foreground">Completed</dt><dd className="text-right">{dayTime(r.completed_at)}</dd></>)}
              <dt className="text-muted-foreground">Parts captured</dt><dd className="text-right font-semibold">{r.parts_captured}</dd>
              <dt className="text-muted-foreground">Issues</dt><dd className="text-right font-semibold">{r.issues_flagged}</dd>
            </dl>
            <div className="mt-auto flex flex-wrap gap-2">
              {canEdit && tab === "eligible" && (
                <Button className="h-11 flex-1" onClick={() => setDialog({ kind: "ready", row: r })}><CircleCheckBig className="size-4" /> Mark Ready for Dismantling</Button>
              )}
              {canEdit && tab === "ready" && (
                <>
                  <Button className="h-11 flex-1" onClick={() => setDialog({ kind: "assign", row: r })}><UserRoundPlus className="size-4" /> Assign Employee</Button>
                  <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: "undo", row: r })}><RotateCcw className="size-4" /> Undo Ready</Button>
                </>
              )}
              {canEdit && tab === "assigned" && (
                <>
                  <Button className="h-11 flex-1" variant="outline" onClick={() => setDialog({ kind: "reassign", row: r })}><UserRoundPlus className="size-4" /> Reassign Employee</Button>
                  <Button variant="outline" className="h-11" onClick={() => setDialog({ kind: "cancel", row: r })}><Ban className="size-4" /> Cancel</Button>
                </>
              )}
              {(tab === "in_progress" || tab === "completed" || tab === "issues") && (
                <Button className="h-11 flex-1" variant="outline" onClick={() => onOpenRecord(r.vehicle_id)}><Eye className="size-4" /> {tab === "completed" ? "Review parts" : "View progress"}</Button>
              )}
              {tab !== "in_progress" && tab !== "completed" && tab !== "issues" && r.assignment_id && (
                <Button variant="ghost" className="h-11" onClick={() => onOpenRecord(r.vehicle_id)}>Record</Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" className="h-10" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {page + 1} of {Math.ceil(total / pageSize)}</span>
          <Button variant="outline" className="h-10" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {dialog && (
        <ActionDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          busy={mut.markReady.isPending || mut.assign.isPending || mut.reassign.isPending || mut.cancel.isPending || mut.undoReady.isPending}
          onMarkReady={() => mut.markReady.mutate(dialog.row.vehicle_id, { onSuccess: () => { toast.success("Vehicle is ready for dismantling."); setDialog(null); }, onError: (e) => toast.error(errorText(e)) })}
          onAssign={(employeeId) => mut.assign.mutate({ vehicleId: dialog.row.vehicle_id, employeeId }, { onSuccess: () => { toast.success("Assigned. Dismantling has not started."); setDialog(null); }, onError: (e) => toast.error(errorText(e)) })}
          onReassign={(employeeId, reason) => mut.reassign.mutate({ vehicleId: dialog.row.vehicle_id, assignmentId: dialog.row.assignment_id!, employeeId, reason }, { onSuccess: () => { toast.success("Reassigned."); setDialog(null); }, onError: (e) => toast.error(errorText(e)) })}
          onCancel={(reason) => mut.cancel.mutate({ vehicleId: dialog.row.vehicle_id, assignmentId: dialog.row.assignment_id!, reason }, { onSuccess: () => { toast.success("Assignment cancelled. The vehicle is ready again."); setDialog(null); }, onError: (e) => toast.error(errorText(e)) })}
          onUndo={(reason) => mut.undoReady.mutate({ vehicleId: dialog.row.vehicle_id, reason }, { onSuccess: () => { toast.success("Ready state undone."); setDialog(null); }, onError: (e) => toast.error(errorText(e)) })}
        />
      )}
    </section>
  );
}

function ActionDialog({
  dialog, onClose, busy, onMarkReady, onAssign, onReassign, onCancel, onUndo,
}: {
  dialog: { kind: "ready" | "assign" | "reassign" | "cancel" | "undo"; row: AdminVehicleRow };
  onClose: () => void;
  busy: boolean;
  onMarkReady: () => void;
  onAssign: (employeeId: string) => void;
  onReassign: (employeeId: string, reason: string) => void;
  onCancel: (reason: string) => void;
  onUndo: (reason: string) => void;
}) {
  const workload = useWorkload();
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const employees: WorkloadRow[] = (workload.data ?? []).filter((e) => dialog.kind !== "reassign" || e.employee_id !== dialog.row.employee_id);
  const title = {
    ready: "Mark ready for dismantling",
    assign: "Assign employee",
    reassign: "Reassign employee",
    cancel: "Cancel assignment",
    undo: "Undo ready for dismantling",
  }[dialog.kind];
  const v = dialog.row;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground break-words">{v.year} {v.make} {v.model} · VIN {v.vin ?? "—"} · Lot {v.lot_number ?? "—"} · Stock {v.stock_number ?? "—"}</p>

        {dialog.kind === "ready" && (
          <p className="text-sm">Confirm this vehicle is physically received and ready to be taken apart. Nothing is assigned by this step.</p>
        )}

        {(dialog.kind === "assign" || dialog.kind === "reassign") && (
          <div className="space-y-2">
            {v.employee_name && dialog.kind === "reassign" && <p className="text-sm">Currently assigned to <b>{v.employee_name}</b>. Reassignment is only possible before work starts.</p>}
            {workload.isPending && <p className="text-sm text-muted-foreground">Loading employees…</p>}
            {!workload.isPending && employees.length === 0 && <p className="text-sm text-muted-foreground">No active dismantling employees are available.</p>}
            <div role="radiogroup" aria-label="Employee" className="grid gap-2">
              {employees.map((e) => (
                <button
                  key={e.employee_id}
                  role="radio"
                  aria-checked={picked === e.employee_id}
                  onClick={() => setPicked(e.employee_id)}
                  className={cn("flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left", picked === e.employee_id ? "border-primary bg-primary/5" : "border-border")}
                >
                  <span className="font-semibold break-words">{e.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{e.assigned} Assigned · {e.in_progress} In Progress</span>
                </button>
              ))}
            </div>
            {dialog.kind === "reassign" && (
              <div className="space-y-1.5">
                <label htmlFor="reassign-reason" className="text-sm font-medium">Reason (required)</label>
                <Input id="reassign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" />
              </div>
            )}
          </div>
        )}

        {(dialog.kind === "cancel" || dialog.kind === "undo") && (
          <div className="space-y-1.5">
            <label htmlFor="action-reason" className="text-sm font-medium">Reason (required)</label>
            <Textarea id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dialog.kind === "cancel" ? "Why the assignment is cancelled" : "Why the ready state is undone"} />
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          {dialog.kind === "ready" && <Button className="h-11 w-full" disabled={busy} onClick={onMarkReady}>Mark Ready for Dismantling</Button>}
          {dialog.kind === "assign" && <Button className="h-11 w-full" disabled={busy || !picked} onClick={() => picked && onAssign(picked)}>Confirm Assignment</Button>}
          {dialog.kind === "reassign" && <Button className="h-11 w-full" disabled={busy || !picked || reason.trim().length < 3} onClick={() => picked && onReassign(picked, reason.trim())}>Confirm Reassignment</Button>}
          {dialog.kind === "cancel" && <Button className="h-11 w-full" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onCancel(reason.trim())}>Cancel Assignment</Button>}
          {dialog.kind === "undo" && <Button className="h-11 w-full" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => onUndo(reason.trim())}>Undo Ready</Button>}
          <Button variant="outline" className="h-11 w-full" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vehicle-centric record: who dismantled this car, and the parts that employee captured. */
export function VehicleRecordPanel({ user, vehicleId, onBack }: { user: User; vehicleId: string; onBack: () => void }) {
  const record = useVehicleRecord(vehicleId);
  const queryClient = useQueryClient();
  const [analyze, setAnalyze] = useState<{ id: string; label: string } | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; partLabel: string } | null>(null);
  const [duplicateRef, setDuplicateRef] = useState("");
  const [rejectFor, setRejectFor] = useState<{ id: string; label: string } | null>(null);
  const [editFor, setEditFor] = useState<{ id: string; captureName: string } | null>(null);
  const [editFields, setEditFields] = useState({ part_name: "", category: "", part_number: "", condition: "" });
  const [rejectReason, setRejectReason] = useState("");
  const canAnalyze = user.role === "owner" || user.role === "manager" || user.role === "engineer_admin";
  const reviewRoles = canAnalyze;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.record(vehicleId) });
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.adminAll() });
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error(errorText(e)); }
  };

  if (record.isPending) return <p className="text-sm text-muted-foreground">Opening vehicle record…</p>;
  if (record.isError || !record.data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorText(record.error)}</p>
        <Button variant="outline" className="h-11" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
      </div>
    );
  }
  const data = record.data;
  const v = data.vehicle;
  const current = data.assignments[0] ?? null;
  const sessionEmployee = current?.employee_name ?? "the assigned employee";
  const groups = new Map<string, typeof data.parts>();
  for (const p of data.parts) {
    const key = p.session_id ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="space-y-5">
      <Button variant="outline" className="h-11" onClick={onBack}><ArrowLeft className="size-4" /> Back to Vehicle Workflow</Button>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-lg font-bold break-words">{v.year} {v.make} {v.model}</h3>
        <p className="font-mono text-xs break-all">VIN {v.vin ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Lot {v.lot_number ?? "—"} · Stock {v.stock_number ?? "—"} · {v.auction_source}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          {[
            ["Assigned Employee", <span key="e" className="font-semibold break-words">{current?.employee_name ?? "—"}</span>],
            ["Assigned By", <span key="b" className="break-words">{current?.assigned_by_name ?? "—"}</span>],
            ["Assigned At", <span key="a">{dayTime(current?.assigned_at ?? null)}</span>],
            ["Started At", <span key="s">{dayTime(current?.started_at ?? null)}</span>],
            ["Completed At", <span key="c">{dayTime(current?.completed_at ?? null)}</span>],
            ["Current Assignment", <span key="x">{current?.status ?? "—"}</span>],
            ["Total Parts Captured", <span key="p" className="font-semibold">{data.parts.filter((p) => p.status !== "rejected").length}</span>],
            ["Issues Flagged", <span key="i" className="font-semibold">{data.issues.length}</span>],
          ].map(([label, value]) => (
            <div key={label as string} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label as string}</dt>
              <dd className="mt-0.5 min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {data.issues.length > 0 && (
        <section className="rounded-xl border border-warning/40 bg-warning/10 p-4">
          <h4 className="font-bold">Issues flagged by the employee</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {data.issues.map((i) => (
              <li key={i.id}><b>{i.issue}</b> · {i.note} <span className="text-xs text-muted-foreground">({i.actor_name ?? "employee"}, {dayTime(i.created_at)})</span></li>
            ))}
          </ul>
        </section>
      )}

      {[...groups.entries()].map(([sessionId, parts]) => {
        const sess = data.sessions.find((s) => s.id === sessionId);
        return (
          <section key={sessionId} className="space-y-3">
            <h4 className="text-base font-bold">Parts dismantled by {sess?.employee_name ?? sessionEmployee}</h4>
            {parts.length === 0 && <p className="text-sm text-muted-foreground">No parts captured in this session.</p>}
            <ol className="grid gap-3 md:grid-cols-2">
              {parts.map((p, idx) => (
                <li key={p.id} className="flex min-w-0 gap-3 rounded-xl border border-border bg-card p-3">
                  <PartPhoto assetId={p.photo_asset_ids[0] ?? null} label={p.capture_name} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs text-muted-foreground">Part {idx + 1} · Captured {dayTime(p.captured_at)}{p.captured_by_name ? ` by ${p.captured_by_name}` : ""}</p>
                    <p className="font-semibold leading-tight break-words">{p.capture_name}</p>
                    <p className="text-xs text-muted-foreground break-words">{p.capture_details}</p>
                    <p className="text-xs">
                      Review: <span className="font-semibold">{reviewLabel(p.status, p.stage)}</span>
                      {p.duplicate_of_part_id && <span> · duplicate of another part</span>}
                    </p>
                    {reviewRoles && (p.status === "manager_review" || p.status === "captured") ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" className="h-10" onClick={() => act(() => processing.approveDismantledPart(p.id), "Approved. Same part record, now in Parts Inventory.")}>Approve</Button>
                        <Button size="sm" variant="outline" className="h-10" onClick={() => { setEditFor({ id: p.id, captureName: p.capture_name }); setEditFields({ part_name: p.part_name || p.capture_name, category: "", part_number: "", condition: "" }); }}>Edit &amp; Approve</Button>
                        <Button size="sm" variant="outline" className="h-10" onClick={() => act(() => processing.keepPartForReview(p.id), "Kept for later review.")}>Keep Later</Button>
                        <Button size="sm" variant="outline" className="h-10" onClick={() => { setDuplicateOf({ id: p.id, partLabel: p.capture_name }); setDuplicateRef(""); }}>Mark Duplicate</Button>
                        <Button size="sm" variant="destructive" className="h-10" onClick={() => { setRejectFor({ id: p.id, label: p.capture_name }); setRejectReason(""); }}>Reject — Not Inventory</Button>
                        {canAnalyze && <Button size="sm" variant="outline" className="h-10" onClick={() => setAnalyze({ id: p.id, label: p.capture_name })}>Analyze Part</Button>}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {editFor && (
        <Dialog open onOpenChange={(o) => !o && setEditFor(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit &amp; approve</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">The employee’s capture text (“{editFor.captureName}”) stays in history. These fields are the final inventory details, set by management.</p>
            <div className="space-y-2">
              {(["part_name", "category", "part_number", "condition"] as const).map((key) => (
                <label key={key} className="block space-y-1 text-sm">
                  <span className="font-medium capitalize">{key.replace("_", " ")}</span>
                  <Input value={editFields[key]} onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))} className="h-11" />
                </label>
              ))}
            </div>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 w-full" disabled={!editFields.part_name.trim()} onClick={() => {
                const fields = Object.fromEntries(Object.entries(editFields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
                act(() => processing.editAndApprovePart(editFor.id, fields), "Approved with final details. Same part record, now in Parts Inventory.").then(() => setEditFor(null));
              }}>Approve with final details</Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => setEditFor(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {analyze && <AnalyzePartDialog open partId={analyze.id} partLabel={analyze.label} onOpenChange={(o) => !o && setAnalyze(null)} />}

      {duplicateOf && (
        <Dialog open onOpenChange={(o) => !o && setDuplicateOf(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Mark duplicate</DialogTitle></DialogHeader>
            <p className="text-sm">“{duplicateOf.partLabel}” duplicates an existing approved part. Enter that part’s id. The duplicate stays in history and cannot be sold.</p>
            <Input value={duplicateRef} onChange={(e) => setDuplicateRef(e.target.value)} placeholder="Existing part id" aria-label="Existing part id" />
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-11 w-full" disabled={duplicateRef.trim().length < 30} onClick={() => act(() => processing.markPartDuplicate(duplicateOf.id, duplicateRef.trim()), "Marked duplicate. Kept in history, not sellable.").then(() => setDuplicateOf(null))}>Mark Duplicate</Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => setDuplicateOf(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {rejectFor && (
        <Dialog open onOpenChange={(o) => !o && setRejectFor(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reject — not inventory</DialogTitle></DialogHeader>
            <p className="text-sm">“{rejectFor.label}” will be kept as history and cannot be sold.</p>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              <Button variant="destructive" className="h-11 w-full" disabled={rejectReason.trim().length < 3} onClick={() => act(() => processing.rejectDismantledPart(rejectFor.id, rejectReason.trim()), "Rejected. Kept in history.").then(() => setRejectFor(null))}>Reject</Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => setRejectFor(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function reviewLabel(status: string, stage: string | null) {
  if (status === "approved") return stage === "ready_for_sale" ? "Approved · Ready for sale" : "Approved · In Parts Inventory";
  if (status === "rejected") return "Rejected · not sellable";
  if (status === "duplicate") return "Duplicate · not sellable";
  if (status === "manager_review" || status === "captured" || status === "draft_ready") return "Needs review";
  return status;
}

function PartPhoto({ assetId, label }: { assetId: string | null; label: string }) {
  const photo = usePersistedPhoto(assetId);
  return (
    <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-muted">
      {photo.data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.data} alt={`${label} photo`} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">{assetId ? "Loading" : "No photo"}</div>
      )}
    </div>
  );
}
