"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { effectiveLoadStatus, loadStatusLabels, paymentStatusLabel, type ScrapLoad } from "@/lib/mock/scrap";

export function LoadDetailSheet({
  load,
  open,
  onOpenChange,
  actorName,
}: {
  load: ScrapLoad | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorName: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Load Details</SheetTitle>
        </SheetHeader>
        {load && <LoadDetailForm key={load.id} load={load} actorName={actorName} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

// Keyed by load.id from the parent so each load gets fresh form state on mount —
// avoids a setState-in-effect sync just to reset fields when the selection changes.
function LoadDetailForm({ load, actorName, onDone }: { load: ScrapLoad; actorName: string; onDone: () => void }) {
  const { saveLoadReview, approveLoad } = useScrapData();
  const [weight, setWeight] = useState(load.weight != null ? String(load.weight) : "");
  const [rate, setRate] = useState(load.rate != null ? String(load.rate) : "");
  const [amount, setAmount] = useState(load.amount != null ? String(load.amount) : "");
  const [notes, setNotes] = useState(load.managerNotes);

  function recompute(nextWeight: string, nextRate: string) {
    const w = Number(nextWeight);
    const r = Number(nextRate);
    if (nextWeight && nextRate && !Number.isNaN(w) && !Number.isNaN(r)) {
      setAmount((Math.round(w * r * 100) / 100).toString());
    }
  }

  function save(andApprove: boolean) {
    saveLoadReview(
      load.id,
      {
        weight: weight ? Number(weight) : null,
        rate: rate ? Number(rate) : null,
        amountOverride: amount ? Number(amount) : null,
        managerNotes: notes,
      },
      actorName
    );
    if (andApprove) approveLoad(load.id, actorName);
    toast.success(andApprove ? "Load saved and approved" : "Load details saved");
    onDone();
  }

  const status = effectiveLoadStatus(load);
  const canApprove = weight !== "" && rate !== "" && status !== "approved" && status !== "closed";

  return (
    <>
      <div className="space-y-4 px-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{load.driverName}</p>
            <p className="text-xs text-muted-foreground">{new Date(load.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
          </div>
          <StatusBadge>{loadStatusLabels[status].toUpperCase()}</StatusBadge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PhotoThumb label="Load Photo" present={!!load.loadPhoto} />
          <PhotoThumb label="Ticket Photo" present={!!load.ticketPhoto} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Weight (lbs)</Label>
            <Input
              type="number"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                recompute(e.target.value, rate);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rate ($/lb)</Label>
            <Input
              type="number"
              step="0.001"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                recompute(weight, e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Amount ($)</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Payment status</Label>
          <p className="text-sm">
            <StatusBadge>{paymentStatusLabel(load).toUpperCase()}</StatusBadge>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Good load, short weight, etc." />
        </div>
      </div>
      <SheetFooter className="flex-row justify-end gap-2">
        <Button variant="outline" onClick={() => save(false)}>
          Save
        </Button>
        <Button disabled={!canApprove} onClick={() => save(true)}>
          <Check className="size-4" /> Save &amp; Approve
        </Button>
      </SheetFooter>
    </>
  );
}

function PhotoThumb({ label, present }: { label: string; present: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-center text-xs">
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded bg-muted text-muted-foreground">
        <Camera className="size-5" />
      </div>
      <span className={present ? "" : "text-muted-foreground"}>{present ? label : `${label} missing`}</span>
    </div>
  );
}
