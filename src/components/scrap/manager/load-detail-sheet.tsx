"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useManagerLoad, useManagerMutations } from "@/lib/query/scrap";
import type { DiscrepancyKind, LoadDetail } from "@/lib/data/scrap";
import { PhotoTile, managerStateLabel, paymentStatusLabelText, timeLabel, usd, lbs, usePhotoUrl } from "@/components/scrap/scrap-shared";

const MANUAL_KINDS: { id: Exclude<DiscrepancyKind, "payment_mismatch">; label: string }[] = [
  { id: "ticket_missing", label: "Ticket missing" },
  { id: "ticket_photo_mismatch", label: "Ticket / photo mismatch" },
  { id: "missing_check_evidence", label: "Missing check evidence" },
  { id: "incomplete_load_evidence", label: "Incomplete load evidence" },
  { id: "unresolved_amount", label: "Unresolved amount" },
  { id: "other", label: "Other" },
];

export function LoadDetailSheet({ loadId, open, onOpenChange }: { loadId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Load details</SheetTitle>
        </SheetHeader>
        {loadId && <LoadDetailBody key={loadId} loadId={loadId} />}
      </SheetContent>
    </Sheet>
  );
}

function LoadDetailBody({ loadId }: { loadId: string }) {
  const detail = useManagerLoad(loadId);
  if (detail.isPending) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (detail.isError || !detail.data) return <p className="p-4 text-sm text-destructive">{detail.error?.message ?? "This load could not be opened."}</p>;
  return <LoadDetailContent data={detail.data} />;
}

function LoadDetailContent({ data }: { data: LoadDetail }) {
  const { load, events, discrepancies, payment } = data;
  const loadPhoto = usePhotoUrl(load.load_photo_asset_id, "medium");
  const ticketPhoto = usePhotoUrl(load.ticket_photo_asset_id, "medium");
  const editable = load.status === "new" || load.status === "ready_for_review";
  const correctable = (load.status === "approved" || load.status === "closed") && !load.payment_id;
  const openDisc = discrepancies.filter((d) => d.status === "open");

  return (
    <div className="space-y-5 px-4 pb-6">
      <section className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge>{managerStateLabel[load.state].toUpperCase()}</StatusBadge>
          <span className="text-muted-foreground">{load.driver_name}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Load date</dt>
          <dd>{load.load_date}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{timeLabel(load.created_at)}</dd>
          <dt className="text-muted-foreground">Delivered</dt>
          <dd>{timeLabel(load.delivered_at)}</dd>
          <dt className="text-muted-foreground">Completed</dt>
          <dd>{timeLabel(load.completed_at)}</dd>
          <dt className="text-muted-foreground">Weight</dt>
          <dd className="tabular-nums">{lbs(load.weight)}</dd>
          <dt className="text-muted-foreground">Rate</dt>
          <dd className="tabular-nums">{load.rate == null ? "—" : `$${load.rate}/lb`}</dd>
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="tabular-nums font-medium">{usd(load.amount)}</dd>
          <dt className="text-muted-foreground">Payment</dt>
          <dd>{paymentStatusLabelText[load.payment_status]}</dd>
        </dl>
        {load.amount_override_reason && <p className="text-xs text-muted-foreground">Amount set manually: {load.amount_override_reason}</p>}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Load photo</p>
          <PhotoTile url={loadPhoto.data} size="h-40 w-full" label="Load photo" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Ticket photo</p>
          <PhotoTile url={ticketPhoto.data} size="h-40 w-full" label="Ticket photo" />
        </div>
      </section>

      {payment && (
        <section className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">Linked payment · {payment.method}{payment.reference_number ? ` ${payment.reference_number}` : ""}</p>
          <p className="text-xs text-muted-foreground">
            {payment.payment_date} · received {usd(payment.amount_received)}
            {payment.correction_of ? " · correction" : ""}
          </p>
        </section>
      )}

      {editable && <MeasurementForm loadId={load.id} current={load} />}
      {load.status === "ready_for_review" && <ApproveButton loadId={load.id} blocked={openDisc.length > 0} hasAmount={load.amount != null} />}
      {correctable && <CorrectionForm loadId={load.id} current={load} />}

      <DiscrepancySection loadId={load.id} discrepancies={discrepancies} />

      <section className="space-y-2">
        <p className="text-sm font-semibold">History</p>
        {events.length === 0 && <EmptyState title="No history yet." />}
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-md border border-border p-2 text-xs">
              <p className="font-medium">{e.event_type.replaceAll("_", " ")}{e.to_status ? ` → ${e.to_status.replaceAll("_", " ")}` : ""}</p>
              <p className="text-muted-foreground">{e.actor_name} · {new Date(e.created_at).toLocaleString()}</p>
              {"reason" in e.detail && typeof e.detail.reason === "string" && <p className="mt-1">{e.detail.reason}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function MeasurementForm({ loadId, current }: { loadId: string; current: LoadDetail["load"] }) {
  const { setMeasurement, setAmountOverride } = useManagerMutations();
  const [weight, setWeight] = useState(current.weight?.toString() ?? "");
  const [rate, setRate] = useState(current.rate?.toString() ?? "");
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState(current.manager_notes ?? "");
  const busy = setMeasurement.isPending || setAmountOverride.isPending;

  function save() {
    const onError = (e: Error) => toast.error(e.message);
    if (override.trim()) {
      setAmountOverride.mutate(
        { loadId, amount: Number(override), reason },
        { onSuccess: () => toast.success("Amount recorded with its reason."), onError }
      );
      return;
    }
    setMeasurement.mutate(
      { loadId, weight: Number(weight), rate: Number(rate), notes },
      { onSuccess: () => toast.success("Weight and rate recorded. The amount is calculated by the server."), onError }
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Weight and rate</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Weight (lb)</Label>
          <Input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={!!override.trim()} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Rate ($/lb)</Label>
          <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!!override.trim()} />
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Weight or rate missing? Enter an amount with a reason</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Amount ($)</Label>
            <Input inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="At least 5 characters" />
          </div>
        </div>
      </details>
      <div className="space-y-1">
        <Label className="text-xs">Manager notes</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button className="w-full" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save measurement"}
      </Button>
    </section>
  );
}

function ApproveButton({ loadId, blocked, hasAmount }: { loadId: string; blocked: boolean; hasAmount: boolean }) {
  const { approve } = useManagerMutations();
  return (
    <div className="space-y-1">
      <Button
        className="w-full"
        disabled={blocked || !hasAmount || approve.isPending}
        onClick={() => approve.mutate(loadId, { onSuccess: () => toast.success("Load approved."), onError: (e) => toast.error(e.message) })}
      >
        <CheckCircle2 className="size-4" /> {approve.isPending ? "Approving…" : "Approve load"}
      </Button>
      {blocked && <p className="text-xs text-destructive">Resolve the open discrepancies on this load first.</p>}
      {!hasAmount && !blocked && <p className="text-xs text-muted-foreground">Record the weight and rate first.</p>}
    </div>
  );
}

function CorrectionForm({ loadId, current }: { loadId: string; current: LoadDetail["load"] }) {
  const { correctFinancials } = useManagerMutations();
  const [weight, setWeight] = useState(current.weight?.toString() ?? "");
  const [rate, setRate] = useState(current.rate?.toString() ?? "");
  const [reason, setReason] = useState("");
  return (
    <section className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-semibold">Correction</p>
      <p className="text-xs text-muted-foreground">This load is approved or closed. A correction needs a reason and keeps the previous values in the history.</p>
      <div className="grid grid-cols-2 gap-2">
        <Input inputMode="decimal" placeholder="Weight (lb)" value={weight} onChange={(e) => setWeight(e.target.value)} />
        <Input inputMode="decimal" placeholder="Rate ($/lb)" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <Input placeholder="Reason (at least 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button
        variant="outline"
        className="w-full"
        disabled={correctFinancials.isPending}
        onClick={() =>
          correctFinancials.mutate(
            { loadId, weight: Number(weight), rate: Number(rate), amount: null, reason },
            { onSuccess: () => toast.success("Correction recorded with its reason."), onError: (e) => toast.error(e.message) }
          )
        }
      >
        {correctFinancials.isPending ? "Saving…" : "Record correction"}
      </Button>
    </section>
  );
}

function DiscrepancySection({ loadId, discrepancies }: { loadId: string; discrepancies: LoadDetail["discrepancies"] }) {
  const { openDiscrepancy, resolveDiscrepancy } = useManagerMutations();
  const [kind, setKind] = useState<(typeof MANUAL_KINDS)[number]["id"]>("ticket_missing");
  const [note, setNote] = useState("");
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});

  return (
    <section className="space-y-3">
      <p className="text-sm font-semibold">Discrepancies</p>
      {discrepancies.length === 0 && <p className="text-xs text-muted-foreground">None on this load.</p>}
      {discrepancies.map((d) => (
        <div key={d.id} className="space-y-2 rounded-md border border-border p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{d.kind.replaceAll("_", " ")}</span>
            <StatusBadge tone={d.status === "open" ? "danger" : "success"}>{d.status.toUpperCase()}</StatusBadge>
          </div>
          <p>{d.note}</p>
          <p className="text-muted-foreground">Opened by {d.opened_by_name} · {new Date(d.opened_at).toLocaleString()}</p>
          {d.status === "resolved" && <p className="text-muted-foreground">Resolved by {d.resolved_by_name}: {d.resolution_note}</p>}
          {d.status === "open" && d.kind !== "payment_mismatch" && (
            <div className="flex gap-2">
              <Input className="h-8 text-xs" placeholder="Resolution note (5+ characters)" value={resolveNote[d.id] ?? ""} onChange={(e) => setResolveNote({ ...resolveNote, [d.id]: e.target.value })} />
              <Button
                size="sm"
                variant="outline"
                disabled={resolveDiscrepancy.isPending}
                onClick={() =>
                  resolveDiscrepancy.mutate(
                    { id: d.id, note: resolveNote[d.id] ?? "" },
                    { onSuccess: () => toast.success("Discrepancy resolved."), onError: (e) => toast.error(e.message) }
                  )
                }
              >
                Resolve
              </Button>
            </div>
          )}
          {d.status === "open" && d.kind === "payment_mismatch" && (
            <p className="text-muted-foreground">Resolved from the Payments tab, where the variance is accepted or corrected.</p>
          )}
        </div>
      ))}
      <div className="space-y-2 rounded-md border border-dashed border-border p-2">
        <p className="text-xs font-medium">Open a discrepancy</p>
        <Select value={kind} onValueChange={(v) => setKind((v as typeof kind) ?? "ticket_missing")}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue>{(v: string) => MANUAL_KINDS.find((k) => k.id === v)?.label ?? "Kind"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MANUAL_KINDS.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea rows={2} className="text-xs" placeholder="What is wrong (5+ characters)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={openDiscrepancy.isPending}
          onClick={() =>
            openDiscrepancy.mutate(
              { kind, loadId, note },
              { onSuccess: () => { setNote(""); toast.success("Discrepancy opened."); }, onError: (e) => toast.error(e.message) }
            )
          }
        >
          Open discrepancy
        </Button>
      </div>
    </section>
  );
}
