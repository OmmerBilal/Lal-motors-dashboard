"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { fetchScrapThumbnailUrls } from "@/lib/data/scrap";
import { PAYMENT_METHODS, PAYMENT_TYPES, CONTAINER_STATUS_LABEL, type ExportInvoice, type ExportInvoiceLine } from "@/lib/data/containers";
import { useConsignees, useExportDetail, useExportMutations, invalidateContainers, usePlannedItems } from "@/lib/query/containers";
import { InvoiceDocument } from "@/components/containers/export/invoice-document";
import { PlannedPartsSection } from "@/components/containers/export/planned-parts-section";
import { CONTAINER_STATUS_TONE } from "@/lib/data/containers";
import { PhotoTile, usd, timeLabel } from "@/components/scrap/scrap-shared";

type LineDraft = { description: string; quantity: string; unit_price: string; category: string; condition: string; source_item_id?: string };
const blankLine = (): LineDraft => ({ description: "", quantity: "1", unit_price: "", category: "", condition: "" });
const toDraft = (items: ExportInvoiceLine[]): LineDraft[] =>
  items.length
    ? items.map((i) => ({ description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price), category: i.category ?? "", condition: i.condition ?? "", source_item_id: i.source_item_id ?? undefined }))
    : [blankLine()];
const toPayload = (lines: LineDraft[]) =>
  lines.filter((l) => l.description.trim() || l.unit_price).map((l) => ({
    description: l.description.trim(), quantity: Number(l.quantity), unit_price: Number(l.unit_price || 0),
    category: l.category.trim() || undefined, condition: l.condition.trim() || undefined, source_item_id: l.source_item_id || undefined,
  }));

/** One container, as export management sees it. Everything shown comes from the export RPC. */
export function ExportContainerDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useExportDetail(id);
  const planned = usePlannedItems(id);
  const d = detail.data;
  const photoIds = (d?.photos ?? []).map((p) => p.id);
  const thumbs = useQuery({ queryKey: ["containers", "export-thumbs", id, photoIds.join(",")], queryFn: () => fetchScrapThumbnailUrls(photoIds), enabled: photoIds.length > 0, staleTime: 60_000 });

  if (detail.isPending) return <p className="text-sm text-muted-foreground">Loading container…</p>;
  if (!d) return <p className="text-sm text-destructive">{detail.error?.message ?? "Not found."}</p>;
  const c = d.container;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{c.t_ref}</h3>
            <p className="text-sm text-muted-foreground">{c.container_number ?? "Official number not confirmed"}</p>
          </div>
          <StatusBadge tone={CONTAINER_STATUS_TONE[c.status]}>{CONTAINER_STATUS_LABEL[c.status].toUpperCase()}</StatusBadge>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">Loader</dt>
            <dd>
              {planned.data?.container.assigned_loader_name ?? "Not assigned"}
              {planned.data?.container.assigned_at ? ` · ${timeLabel(planned.data.container.assigned_at)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Loading finished</dt>
            <dd>{c.finished_at ? new Date(c.finished_at).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Closed</dt>
            <dd>{c.closed_at ? new Date(c.closed_at).toLocaleString() : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Loader evidence</h4>
        {d.photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photos were attached by the loader.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {d.photos.map((p) => (
              <div key={p.id} className="space-y-1">
                <PhotoTile url={thumbs.data?.[p.id]} size="h-24 w-full" label={p.role.replaceAll("_", " ")} />
                <p className="text-[11px] text-muted-foreground">{p.role.replaceAll("_", " ")}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <PlannedPartsSection containerId={id} status={c.status} partsPlanning={planned.data?.container.parts_planning ?? false} />

      <ShippingSection id={id} detail={d} onSaved={() => invalidateContainers(qc)} />
      <InvoiceSection containerId={id} detail={d} />
      <PaymentsSection detail={d} />
      <ShipCloseSection containerId={id} detail={d} />

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">History</h4>
        {d.events.length === 0 && <EmptyState title="No history yet." />}
        <ol className="space-y-1 text-xs">
          {d.events.map((e, i) => (
            <li key={i} className="rounded-md border border-border p-2">
              <span className="font-medium">{e.action.replaceAll("_", " ")}</span> · {e.actor_name} · {new Date(e.created_at).toLocaleString()}
              {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ShippingSection({ id, detail, onSaved }: { id: string; detail: NonNullable<ReturnType<typeof useExportDetail>["data"]>; onSaved: () => void }) {
  const { saveShipping, saveConsignee } = useExportMutations();
  const consignees = useConsignees(null);
  const s = detail.shipping;
  const [consigneeId, setConsigneeId] = useState<string | null>(s?.consignee_id ?? null);
  const [country, setCountry] = useState(s?.destination_country ?? "");
  const [port, setPort] = useState(s?.destination_port ?? "");
  const [trucking, setTrucking] = useState(s?.trucking_company ?? "");
  const [note, setNote] = useState(s?.shipping_note ?? "");
  const [newCompany, setNewCompany] = useState("");
  const closed = detail.container.status === "closed";

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">Consignee and shipping</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Consignee (reusable)</Label>
          <Select value={consigneeId ?? ""} onValueChange={(v) => setConsigneeId(v || null)} disabled={closed}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a consignee">{(v: string) => consignees.data?.find((c) => c.id === v)?.company ?? "Choose a consignee"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(consignees.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.company}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Input placeholder="New consignee company" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} disabled={closed} />
          <Button
            variant="outline"
            disabled={closed || newCompany.trim().length < 2 || saveConsignee.isPending}
            onClick={() =>
              saveConsignee.mutate({ company: newCompany.trim() }, {
                onSuccess: (c) => { setConsigneeId(c.id); setNewCompany(""); toast.success("Consignee saved."); onSaved(); },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            Add
          </Button>
        </div>
        <div className="space-y-1"><Label className="text-xs">Destination country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} disabled={closed} /></div>
        <div className="space-y-1"><Label className="text-xs">Destination port</Label><Input value={port} onChange={(e) => setPort(e.target.value)} disabled={closed} /></div>
        <div className="space-y-1"><Label className="text-xs">Trucking company</Label><Input value={trucking} onChange={(e) => setTrucking(e.target.value)} disabled={closed} /></div>
        <div className="space-y-1"><Label className="text-xs">Shipping note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={closed} /></div>
      </div>
      <Button
        disabled={closed || saveShipping.isPending}
        onClick={() =>
          saveShipping.mutate(
            { containerId: id, consigneeId, destinationCountry: country, destinationPort: port, truckingCompany: trucking, shipDate: null, eta: null, note },
            { onSuccess: () => toast.success("Shipping details saved."), onError: (e) => toast.error(e.message) }
          )
        }
      >
        Save shipping details
      </Button>
    </section>
  );
}

function InvoiceSection({ containerId, detail }: { containerId: string; detail: NonNullable<ReturnType<typeof useExportDetail>["data"]> }) {
  const { createInvoice } = useExportMutations();
  const inv = detail.invoice;
  const canCreate = detail.container.status === "ready_for_invoice" || detail.container.status === "on_the_way";
  const [requestId] = useState(() => crypto.randomUUID());

  if (!inv) {
    return (
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-semibold">Invoice</h4>
        {canCreate ? (
          <Button disabled={createInvoice.isPending} onClick={() => createInvoice.mutate({ containerId, requestId }, { onSuccess: () => toast.success("Draft invoice created."), onError: (e) => toast.error(e.message) })}>
            Create draft invoice
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">An invoice can be created once loading is finished.</p>
        )}
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {inv.status === "Finalized" ? <FinalizedInvoice inv={inv} /> : <DraftInvoice inv={inv} />}
      <InvoiceDocument invoice={inv} className="print-area" />
      <Revisions detail={detail} />
    </div>
  );
}

function DraftInvoice({ inv }: { inv: ExportInvoice }) {
  const { saveDraft, review, finalize } = useExportMutations();
  const consignees = useConsignees(null);
  const [consigneeId, setConsigneeId] = useState<string | null>(inv.consignee_id);
  const [notes, setNotes] = useState(inv.notes);
  const [lines, setLines] = useState<LineDraft[]>(() => toDraft(inv.items));
  const [finalRequest] = useState(() => crypto.randomUUID());
  // Finalizing is irreversible: a person confirms it on a second step, and can go back without any server call.
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const loadedParts = usePlannedItems(inv.container_id);
  const loaded = (loadedParts.data?.items ?? []).filter((i) => i.status === "finalized" && i.loaded_qty > 0);
  const busy = saveDraft.isPending || review.isPending || finalize.isPending;

  // Starts the draft from what was actually loaded. Quantity is the loaded quantity; the unit price is set by management.
  function addLoadedParts() {
    const linked = new Set(lines.map((l) => l.source_item_id).filter(Boolean));
    const fresh: LineDraft[] = loaded
      .filter((i) => !linked.has(i.id))
      .map((i) => ({ description: i.part_name, quantity: String(i.loaded_qty), unit_price: "", category: "", condition: "", source_item_id: i.id }));
    if (!fresh.length) return;
    const onlyBlank = lines.length === 1 && !lines[0].description.trim() && !lines[0].unit_price;
    setLines((prev) => (onlyBlank ? fresh : [...prev, ...fresh]));
  }
  const payload = toPayload(lines);
  const draftTotal = payload.reduce((n, l) => n + Math.round(l.quantity * l.unit_price * 100), 0) / 100;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Draft invoice</h4>
        <StatusBadge tone="warning">{inv.status.toUpperCase()}</StatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">No invoice number is assigned until the invoice is finalized.</p>
      <div className="space-y-1">
        <Label className="text-xs">Consignee</Label>
        <Select value={consigneeId ?? ""} onValueChange={(v) => setConsigneeId(v || null)}>
          <SelectTrigger className="w-full sm:w-96">
            <SelectValue placeholder="Choose a consignee">{(v: string) => consignees.data?.find((c) => c.id === v)?.company ?? "Choose a consignee"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(consignees.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.company}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loaded.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 p-2.5 text-sm">
          <span className="text-xs text-muted-foreground">{loaded.length} loaded part(s) in this container. Lines start from the loaded quantities; set the prices.</span>
          <Button variant="outline" size="sm" onClick={addLoadedParts} disabled={busy}>Add loaded parts as lines</Button>
        </div>
      )}
      <LineEditor lines={lines} setLines={setLines} />
      <div className="space-y-1">
        <Label className="text-xs">Notes</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <p className="text-sm">Draft total (server recalculates on save): <b className="tabular-nums">{usd(draftTotal)}</b></p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !consigneeId} onClick={() => saveDraft.mutate({ invoiceId: inv.id, consigneeId: consigneeId!, notes, lines: payload }, { onSuccess: () => toast.success("Draft saved."), onError: (e) => toast.error(e.message) })}>
          Save draft
        </Button>
        {inv.status === "Draft" && (
          <Button variant="outline" disabled={busy} onClick={() => review.mutate(inv.id, { onSuccess: () => toast.success("Sent to review."), onError: (e) => toast.error(e.message) })}>
            Send to review
          </Button>
        )}
        {!confirmingFinalize ? (
          <Button disabled={busy || !inv.consignee_id} onClick={() => setConfirmingFinalize(true)}>
            Finalize invoice…
          </Button>
        ) : (
          <div className="w-full space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-semibold">Finalize this invoice? This cannot be undone.</p>
            <p className="text-xs text-muted-foreground">The content is fixed after finalizing. A later correction is a new revision with a reason. Going back changes nothing.</p>
            <div className="grid grid-cols-1 gap-2 sm:flex">
              <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmingFinalize(false)}>Back</Button>
              <Button className="min-h-11" disabled={busy || !inv.consignee_id} onClick={() => finalize.mutate({ invoiceId: inv.id, requestId: finalRequest }, { onSuccess: (f) => { setConfirmingFinalize(false); toast.success(`Invoice ${f.invoice_number} finalized.`); }, onError: (e) => toast.error(e.message) })}>
                Confirm finalize
              </Button>
            </div>
          </div>
        )}
      </div>
      {inv.status === "Draft" && <p className="text-xs text-muted-foreground">Finalize uses the last saved draft. Save before finalizing.</p>}
    </section>
  );
}

function FinalizedInvoice({ inv }: { inv: ExportInvoice }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Invoice {inv.invoice_number}</h4>
        <StatusBadge tone="success">FINALIZED</StatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">Finalized content is fixed. A correction is a new revision with a reason.</p>
      <ItemsTable items={inv.items} />
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div><p className="text-xs text-muted-foreground">Total</p><p className="tabular-nums">{usd(inv.total)}</p></div>
        <div><p className="text-xs text-muted-foreground">Paid</p><p className="tabular-nums">{usd(inv.paid)}</p></div>
        <div><p className="text-xs text-muted-foreground">Balance</p><p className="tabular-nums font-semibold">{usd(inv.balance)}</p></div>
      </div>
      <Button variant="outline" onClick={() => window.print()}>Print invoice</Button>
    </section>
  );
}

function Revisions({ detail }: { detail: NonNullable<ReturnType<typeof useExportDetail>["data"]> }) {
  const { revise } = useExportMutations();
  const inv = detail.invoice!;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => toDraft(inv.items));
  const [requestId] = useState(() => crypto.randomUUID());
  const [consigneeId] = useState<string | null>(inv.consignee_id);
  if (inv.status !== "Finalized") return null;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Revisions ({detail.revisions.length})</h4>
        <Button variant="outline" size="sm" onClick={() => setOpen((x) => !x)}>{open ? "Close" : "New revision"}</Button>
      </div>
      {detail.revisions.map((r) => (
        <div key={r.revision_number} className="rounded-md border border-border p-2 text-xs">
          Revision {r.revision_number} · {new Date(r.saved_at).toLocaleString()} · {r.reason}
        </div>
      ))}
      {open && (
        <div className="space-y-3">
          <LineEditor lines={lines} setLines={setLines} />
          <Input placeholder="Reason for the revision (at least 5 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button
            disabled={revise.isPending || !consigneeId || reason.trim().length < 5}
            onClick={() =>
              revise.mutate({ invoiceId: inv.id, reason, consigneeId: consigneeId!, lines: toPayload(lines), requestId }, {
                onSuccess: () => { toast.success("Revision saved. The original invoice is unchanged."); setOpen(false); },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            Save revision
          </Button>
        </div>
      )}
    </section>
  );
}

function PaymentsSection({ detail }: { detail: NonNullable<ReturnType<typeof useExportDetail>["data"]> }) {
  const { recordPayment, reversePayment } = useExportMutations();
  const inv = detail.invoice;
  const [type, setType] = useState<(typeof PAYMENT_TYPES)[number]>("Deposit");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("Wire");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const canRecord = !!inv && inv.status === "Finalized";

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">Payments</h4>
      {!inv || inv.status !== "Finalized" ? (
        <p className="text-xs text-muted-foreground">Payments are recorded once the invoice is finalized.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-xs text-muted-foreground">Total</p><p className="tabular-nums">{usd(inv.total)}</p></div>
            <div><p className="text-xs text-muted-foreground">Paid</p><p className="tabular-nums">{usd(inv.paid)}</p></div>
            <div><p className="text-xs text-muted-foreground">Balance</p><p className="tabular-nums font-semibold">{usd(inv.balance)}</p></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            <Select value={type} onValueChange={(v) => setType((v as typeof type) ?? "Deposit")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={method} onValueChange={(v) => setMethod((v as typeof method) ?? "Wire")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Input inputMode="decimal" placeholder={`Amount (max ${inv.balance})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input placeholder="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            <Button
              disabled={!canRecord || recordPayment.isPending || !amount}
              onClick={() =>
                recordPayment.mutate({ invoiceId: inv.id, amount: Number(amount), type, method, reference, notes: "", requestId }, {
                  onSuccess: () => { toast.success("Payment recorded."); setAmount(""); setReference(""); setRequestId(crypto.randomUUID()); },
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Record payment
            </Button>
          </div>
        </>
      )}

      {detail.payments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>State</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.payment_date}</TableCell>
                <TableCell>{p.correction_of ? "Reversal" : p.type}</TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell>{p.reference_number || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(p.amount)}</TableCell>
                <TableCell>{p.correction_of ? <StatusBadge tone="info">REVERSAL</StatusBadge> : p.reversed ? <StatusBadge tone="neutral">REVERSED</StatusBadge> : <StatusBadge tone="success">POSTED</StatusBadge>}</TableCell>
                <TableCell className="text-right">
                  {!p.correction_of && !p.reversed && canRecord && (
                    reversing === p.id ? (
                      <span className="inline-flex gap-1">
                        <Input className="h-8 w-48 text-xs" placeholder="Reason (5+ characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button size="sm" variant="outline" disabled={reason.trim().length < 5 || reversePayment.isPending}
                          onClick={() => reversePayment.mutate({ paymentId: p.id, reason, requestId: crypto.randomUUID() }, { onSuccess: () => { toast.success("Payment reversed. The original is kept."); setReversing(null); setReason(""); }, onError: (e) => toast.error(e.message) })}>
                          Reverse
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setReversing(p.id)}>Reverse</Button>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ShipCloseSection({ containerId, detail }: { containerId: string; detail: NonNullable<ReturnType<typeof useExportDetail>["data"]> }) {
  const { onTheWay, close } = useExportMutations();
  const [reference, setReference] = useState("");
  const status = detail.container.status;
  const inv = detail.invoice;
  const finalized = inv?.status === "Finalized";
  const zeroBalance = !!inv && Number(inv.balance) === 0;
  const [reqA] = useState(() => crypto.randomUUID());
  const [reqB] = useState(() => crypto.randomUUID());

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h4 className="text-sm font-semibold">Shipping and close</h4>
      <p className="text-xs text-muted-foreground">Status: {CONTAINER_STATUS_LABEL[status]}. Going on the way needs a finalized invoice. Closing needs a zero balance.</p>
      {status === "ready_for_invoice" && (
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Shipping reference (BOL / booking)" value={reference} onChange={(e) => setReference(e.target.value)} className="max-w-xs" />
          <Button disabled={!finalized || onTheWay.isPending} onClick={() => onTheWay.mutate({ containerId, reference, requestId: reqA }, { onSuccess: () => toast.success("Container is on the way."), onError: (e) => toast.error(e.message) })}>
            Mark on the way
          </Button>
        </div>
      )}
      {status === "on_the_way" && (
        <Button disabled={!zeroBalance || close.isPending} onClick={() => close.mutate({ containerId, requestId: reqB }, { onSuccess: () => toast.success("Container closed."), onError: (e) => toast.error(e.message) })}>
          Close container
        </Button>
      )}
      {status === "on_the_way" && !zeroBalance && <p className="text-xs text-muted-foreground">Close is available once the balance is zero.</p>}
      {status === "closed" && <p className="text-sm">Closed {detail.container.closed_at ? new Date(detail.container.closed_at).toLocaleString() : ""}.</p>}
    </section>
  );
}

function ItemsTable({ items }: { items: ExportInvoiceLine[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Condition</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Line total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i, n) => (
            <TableRow key={n}>
              <TableCell>{i.description}</TableCell><TableCell>{i.category ?? "—"}</TableCell><TableCell>{i.condition ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(i.unit_price)}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(i.line_total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LineEditor({ lines, setLines }: { lines: LineDraft[]; setLines: (l: LineDraft[]) => void }) {
  const update = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Input className="sm:col-span-2" placeholder="Description" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
          <Input inputMode="numeric" placeholder="Qty" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
          <Input inputMode="decimal" placeholder="Unit price" value={l.unit_price} onChange={(e) => update(i, { unit_price: e.target.value })} />
          <Input placeholder="Category" value={l.category} onChange={(e) => update(i, { category: e.target.value })} />
          <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, n) => n !== i).length ? lines.filter((_, n) => n !== i) : [blankLine()])}>Remove</Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setLines([...lines, blankLine()])}>Add line</Button>
    </div>
  );
}

