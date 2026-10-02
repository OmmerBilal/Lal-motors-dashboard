"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useSalesData } from "@/components/sales/sales-data-context";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { rimAgingLabel, rimCompletionStatus, rimRemaining, type RimObligation } from "@/lib/mock/scrap";
import type { Customer } from "@/lib/mock/sales";

const agingTone: Record<string, "success" | "warning" | "danger"> = {
  "Up to Date": "success",
  "3 Days": "warning",
  "6 Days": "warning",
  "Over 1 Week": "danger",
};

function customerLabel(c: Customer) {
  return c.companyName || `${c.firstName} ${c.lastName}`.trim();
}

export function TireShopPanel({ actorName }: { actorName: string }) {
  const { customers } = useSalesData();
  const { rimObligations, createRimObligation, recordRimReturn } = useScrapData();

  const [newOpen, setNewOpen] = useState(false);
  const [detailObligation, setDetailObligation] = useState<RimObligation | null>(null);

  // one card per customer that has at least one obligation (most recent first)
  const customerCards = useMemo(() => {
    const byCustomer = new Map<string, RimObligation[]>();
    for (const o of rimObligations) {
      byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) || []), o]);
    }
    return [...byCustomer.entries()]
      .map(([customerId, obligations]) => {
        const customer = customers.find((c) => c.id === customerId);
        const remaining = obligations.reduce(
          (acc, o) => {
            const r = rimRemaining(o);
            return { aluminum: acc.aluminum + r.aluminum, steel: acc.steel + r.steel };
          },
          { aluminum: 0, steel: 0 }
        );
        const latest = [...obligations].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
        return { customer, obligations, remaining, aging: rimAgingLabel(latest) };
      })
      .filter((c) => c.customer);
  }, [rimObligations, customers]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tire Shop Customers (Rim Balances)</h3>
          <p className="text-xs text-muted-foreground">Track tires and rims taken and returned</p>
        </div>
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> Add Customer
        </Button>
      </div>

      {customerCards.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {customerCards.map(({ customer, remaining, aging, obligations }) => (
            <div key={customer!.id} className="rounded-lg border border-border p-3">
              <p className="truncate text-sm font-semibold">{customerLabel(customer!)}</p>
              <p className="text-xs text-muted-foreground">{customer!.phone}</p>
              <p className="mt-2 text-sm">
                <span className="font-semibold text-accent-gold-foreground">{remaining.aluminum}</span> Aluminum Rims Owed
              </p>
              <p className="text-sm">
                <span className="font-semibold">{remaining.steel}</span> Steel Rims Owed
              </p>
              <div className="mt-2">
                <StatusBadge tone={agingTone[aging]}>{aging}</StatusBadge>
              </div>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setDetailObligation(obligations[0])}>
                View Details
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Search} title="No rim obligations yet" description="Add a customer to start tracking tire/rim balances." />
      )}

      <NewObligationDialog open={newOpen} onOpenChange={setNewOpen} customers={customers} actorName={actorName} onCreate={createRimObligation} />
      <ObligationDetailDialog
        obligation={detailObligation}
        allForCustomer={detailObligation ? rimObligations.filter((o) => o.customerId === detailObligation.customerId) : []}
        customer={detailObligation ? customers.find((c) => c.id === detailObligation.customerId) : undefined}
        onClose={() => setDetailObligation(null)}
        actorName={actorName}
        onRecordReturn={recordRimReturn}
      />
    </div>
  );
}

function NewObligationDialog({
  open,
  onOpenChange,
  customers,
  actorName,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  actorName: string;
  onCreate: (input: { customerId: string; tiresQty: number; aluminumOwed: number; steelOwed: number; employeeName: string; notes: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [tires, setTires] = useState("");
  const [aluminum, setAluminum] = useState("");
  const [steel, setSteel] = useState("");
  const [notes, setNotes] = useState("");

  const matches = query.trim()
    ? customers.filter((c) => `${c.companyName} ${c.firstName} ${c.lastName} ${c.phone} ${c.customerNumber}`.toLowerCase().includes(query.toLowerCase()))
    : customers;

  function submit() {
    if (!customerId || (!aluminum && !steel)) return;
    onCreate({ customerId, tiresQty: Number(tires) || 0, aluminumOwed: Number(aluminum) || 0, steelOwed: Number(steel) || 0, employeeName: actorName, notes });
    toast.success("Rim obligation recorded");
    onOpenChange(false);
    setCustomerId("");
    setQuery("");
    setTires("");
    setAluminum("");
    setSteel("");
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Rim Obligation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Input placeholder="Search by company, name or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="max-h-32 overflow-y-auto rounded-md border border-border">
              {matches.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomerId(c.id)}
                  className={`block w-full px-2.5 py-1.5 text-left text-sm hover:bg-accent/30 ${customerId === c.id ? "bg-accent/40 font-medium" : ""}`}
                >
                  {customerLabel(c)} <span className="text-xs text-muted-foreground">· {c.phone || c.customerNumber}</span>
                </button>
              ))}
              {!matches.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">No matching customers. Add them under Customers &amp; Sales.</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Tires qty</Label>
              <Input type="number" min={0} value={tires} onChange={(e) => setTires(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Aluminum owed</Label>
              <Input type="number" min={0} value={aluminum} onChange={(e) => setAluminum(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Steel owed</Label>
              <Input type="number" min={0} value={steel} onChange={(e) => setSteel(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">Pickup photo is captured automatically in this demo step.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!customerId || (!aluminum && !steel)} onClick={submit}>
            Save Obligation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ObligationDetailDialog({
  obligation,
  allForCustomer,
  customer,
  onClose,
  actorName,
  onRecordReturn,
}: {
  obligation: RimObligation | null;
  allForCustomer: RimObligation[];
  customer: Customer | undefined;
  onClose: () => void;
  actorName: string;
  onRecordReturn: (obligationId: string, input: { aluminumReturned: number; steelReturned: number; notes: string; employeeName: string }) => void;
}) {
  const [aluminum, setAluminum] = useState("");
  const [steel, setSteel] = useState("");
  const [notes, setNotes] = useState("");

  if (!obligation) return null;
  const remaining = rimRemaining(obligation);
  const status = rimCompletionStatus(obligation);

  function submitReturn() {
    if (!obligation) return;
    const al = Math.min(Number(aluminum) || 0, remaining.aluminum);
    const st = Math.min(Number(steel) || 0, remaining.steel);
    if (al <= 0 && st <= 0) return;
    onRecordReturn(obligation.id, { aluminumReturned: al, steelReturned: st, notes, employeeName: actorName });
    toast.success("Return recorded");
    setAluminum("");
    setSteel("");
    setNotes("");
  }

  return (
    <Dialog open={!!obligation} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? customerLabel(customer) : "Rim Obligation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span>Status</span>
            <StatusBadge>{status.toUpperCase()}</StatusBadge>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 text-sm">
            <span>
              Aluminum remaining
              <br />
              <b className="text-base">{remaining.aluminum}</b>
            </span>
            <span>
              Steel remaining
              <br />
              <b className="text-base">{remaining.steel}</b>
            </span>
          </div>

          {(remaining.aluminum > 0 || remaining.steel > 0) && (
            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-semibold">Record Return</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Aluminum returned</Label>
                  <Input type="number" min={0} max={remaining.aluminum} value={aluminum} onChange={(e) => setAluminum(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Steel returned</Label>
                  <Input type="number" min={0} max={remaining.steel} value={steel} onChange={(e) => setSteel(e.target.value)} />
                </div>
              </div>
              <Textarea rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button size="sm" onClick={submitReturn}>
                Save Return
              </Button>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">History</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              {allForCustomer.map((o) => (
                <div key={o.id}>
                  <p>
                    {new Date(o.createdAt).toLocaleDateString()} · Obligation: {o.aluminumOwed} aluminum / {o.steelOwed} steel ({o.tiresQty} tires) · {o.employeeName}
                  </p>
                  {o.returns.map((r) => (
                    <p key={r.id} className="pl-3">
                      ↳ {new Date(r.createdAt).toLocaleDateString()} return: {r.aluminumReturned} aluminum / {r.steelReturned} steel · {r.employeeName}
                      {r.notes && ` — ${r.notes}`}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
