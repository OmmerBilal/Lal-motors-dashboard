"use client";

import { useState } from "react";
import { ArrowLeft, Camera, Check, CheckCheck, Copy, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useDismantlingProcessingData, type ReviewCandidate } from "@/components/dismantling-processing/use-dismantling-data";
import { rejectReasons, suggestedOem } from "@/lib/mock/dismantling-processing";
import type { User } from "@/lib/types";
import { toast } from "sonner";

export function NeedsReviewQueue({
  user,
  onBack,
  onOpenVehicle,
}: {
  user: User;
  onBack: () => void;
  onOpenVehicle: (vehicleId: string) => void;
}) {
  const { reviewCandidates, recordEvent } = useDismantlingProcessingData();

  const [editTarget, setEditTarget] = useState<ReviewCandidate | null>(null);
  const [editPartType, setEditPartType] = useState("");
  const [editOem, setEditOem] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [rejectTarget, setRejectTarget] = useState<ReviewCandidate | null>(null);
  const [rejectReason, setRejectReason] = useState<string>(rejectReasons[0]);

  function approve(candidate: ReviewCandidate) {
    recordEvent({
      vehicleId: candidate.vehicle.id,
      action: "REVIEW_APPROVED",
      actorId: user.id,
      partId: candidate.event.partId,
      partType: candidate.event.partType,
      note: "Approved as identified",
    });
    toast.success(`${candidate.event.partType} approved`);
  }

  function markDuplicate(candidate: ReviewCandidate) {
    recordEvent({
      vehicleId: candidate.vehicle.id,
      action: "REVIEW_MARKED_DUPLICATE",
      actorId: user.id,
      partId: candidate.event.partId,
      partType: candidate.event.partType,
      note: "Marked as duplicate — not added to inventory",
    });
    toast.success("Marked as duplicate");
  }

  function keepForLater(candidate: ReviewCandidate) {
    recordEvent({
      vehicleId: candidate.vehicle.id,
      action: "REVIEW_KEPT_FOR_LATER",
      actorId: user.id,
      partId: candidate.event.partId,
      partType: candidate.event.partType,
      note: "Kept for later review",
    });
    toast.info("Kept for later review");
  }

  function openEdit(candidate: ReviewCandidate) {
    setEditTarget(candidate);
    setEditPartType(candidate.event.partType || "");
    setEditOem(candidate.event.partId ? suggestedOem(candidate.event.partId) : "");
    setEditNotes("");
  }

  function saveEdit() {
    if (!editTarget) return;
    recordEvent({
      vehicleId: editTarget.vehicle.id,
      action: "REVIEW_EDITED_APPROVED",
      actorId: user.id,
      partId: editTarget.event.partId,
      partType: editPartType,
      note: `OEM ${editOem || "—"}${editNotes ? ` · ${editNotes}` : ""}`,
    });
    toast.success("Correction saved & approved");
    setEditTarget(null);
  }

  function openReject(candidate: ReviewCandidate) {
    setRejectTarget(candidate);
    setRejectReason(rejectReasons[0]);
  }

  function saveReject() {
    if (!rejectTarget) return;
    recordEvent({
      vehicleId: rejectTarget.vehicle.id,
      action: "REVIEW_REJECTED",
      actorId: user.id,
      partId: rejectTarget.event.partId,
      partType: rejectTarget.event.partType,
      note: rejectReason,
    });
    toast.success("Rejected — not added to inventory");
    setRejectTarget(null);
  }

  function approveAll() {
    const safe = reviewCandidates.filter((c) => c.kind === "needs_review");
    if (!safe.length) return;
    safe.forEach((c) => approve(c));
  }

  const safeCount = reviewCandidates.filter((c) => c.kind === "needs_review").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button size="sm" disabled={!safeCount} onClick={approveAll}>
          <CheckCheck className="size-4" /> Approve All ({safeCount} safe)
        </Button>
      </div>

      <div>
        <h3 className="text-lg font-semibold">Needs Review</h3>
        <p className="text-sm text-muted-foreground">
          {reviewCandidates.length} item{reviewCandidates.length === 1 ? "" : "s"} need review. Possible duplicates and
          items with uncertain fitment are excluded from Approve All.
        </p>
      </div>

      {!reviewCandidates.length && (
        <EmptyState icon={CheckCheck} title="Queue clear" description="No captured parts are waiting on manager review." />
      )}

      <div className="space-y-3">
        {reviewCandidates.map((candidate) => (
          <article key={candidate.event.id} className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[auto_1fr_auto]">
            <div className="flex aspect-[4/3] w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground">
              <Camera className="size-6" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-sm">{candidate.event.partType}</b>
                <StatusBadge tone="warning">
                  {candidate.kind === "possible_duplicate" ? "Needs Verification" : "AI Suggested"}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {candidate.kind === "possible_duplicate" ? "Possible duplicate" : "AI uncertain"}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Employee: {candidate.employeeName} · Suggested OEM {candidate.event.partId ? suggestedOem(candidate.event.partId) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {candidate.vehicle.year} {candidate.vehicle.make} {candidate.vehicle.model} · VIN {candidate.vehicle.vin} · Stock{" "}
                {candidate.vehicle.stockNumber || candidate.vehicle.lotNumber || "—"}
              </p>
              <button
                className="mt-1 text-xs font-medium text-primary hover:underline"
                onClick={() => onOpenVehicle(candidate.vehicle.id)}
              >
                Open donor vehicle & history
              </button>
            </div>

            <div className="flex flex-col gap-1.5 lg:w-48">
              {candidate.kind === "possible_duplicate" ? (
                <>
                  <Button size="sm" onClick={() => approve(candidate)}>
                    <Check className="size-4" /> Keep as Separate Part
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => markDuplicate(candidate)}>
                    <Copy className="size-4" /> Mark Duplicate
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => approve(candidate)}>
                  <Check className="size-4" /> Approve
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => openEdit(candidate)}>
                <Pencil className="size-4" /> Edit &amp; Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => openReject(candidate)}>
                <X className="size-4" /> Reject / Not Inventory
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => keepForLater(candidate)}>
                Keep for Later
              </Button>
            </div>
          </article>
        ))}
      </div>

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit &amp; Approve</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Part name / category</Label>
              <Input value={editPartType} onChange={(e) => setEditPartType(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>OEM / part number</Label>
              <Input value={editOem} onChange={(e) => setEditOem(e.target.value)} placeholder="Enter corrected OEM #" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Side/position, fitment notes, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button disabled={!editPartType.trim()} onClick={saveEdit}>
              Save &amp; Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject / Not Inventory</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={rejectReason} onValueChange={(v) => setRejectReason(v ?? rejectReasons[0])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rejectReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={saveReject}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
