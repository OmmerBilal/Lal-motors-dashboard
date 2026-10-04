"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useCustomerList } from "@/lib/query/customers";
import { useRimList, useRimObligation, useManagerMutations } from "@/lib/query/scrap";
import type { RimObligation } from "@/lib/data/scrap";
import { dateLabel } from "@/components/scrap/scrap-shared";

/** Tire and rim obligations for existing customers. The server holds the balances; a return is refused if it exceeds what is still owed. */
export function TireShopPanel() {
  const [status, setStatus] = useState<"open" | "completed" | "all">("open");
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) return <RimDetail id={openId} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-4">
      <NewObligationForm />
      <ObligationList status={status} onStatus={setStatus} onOpen={setOpenId} />
    </div>
  );
}

function NewObligationForm() {
  const { createRim } = useManagerMutations();
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [tires, setTires] = useState("0");
  const [alu, setAlu] = useState("");
  const [steel, setSteel] = useState("");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const customers = useCustomerList(search.trim());
  const matches = search.trim() ? (customers.data?.pages[0]?.rows ?? []).slice(0, 6) : [];

  function submit() {
    if (!customer) return toast.error("Choose a customer.");
    createRim.mutate(
      { customerId: customer.id, tires: Number(tires || 0), aluminum: Number(alu || 0), steel: Number(steel || 0), notes, requestId },
      {
        onSuccess: () => {
          toast.success("Tire/rim obligation recorded.");
          setCustomer(null);
          setSearch("");
          setTires("0");
          setAlu("");
          setSteel("");
          setNotes("");
          setRequestId(crypto.randomUUID());
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">New tire/rim obligation</h3>
      {customer ? (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>{customer.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setCustomer(null)}>Change</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Input placeholder="Search customer by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          {matches.map((c) => (
            <button key={c.id} onClick={() => setCustomer({ id: c.id, name: c.display_name })} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/40">
              {c.display_name} <span className="text-xs text-muted-foreground">{c.phone}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Tires</Label>
          <Input inputMode="numeric" value={tires} onChange={(e) => setTires(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Aluminum rims owed</Label>
          <Input inputMode="numeric" value={alu} onChange={(e) => setAlu(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Steel rims owed</Label>
          <Input inputMode="numeric" value={steel} onChange={(e) => setSteel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Button disabled={createRim.isPending || !customer} onClick={submit}>
        {createRim.isPending ? "Saving…" : "Record obligation"}
      </Button>
    </section>
  );
}

function ObligationList({ status, onStatus, onOpen }: { status: "open" | "completed" | "all"; onStatus: (s: "open" | "completed" | "all") => void; onOpen: (id: string) => void }) {
  const list = useRimList(status);
  const rows: RimObligation[] = list.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Obligations</h3>
        <div className="flex gap-1">
          {(["open", "completed", "all"] as const).map((s) => (
            <button key={s} onClick={() => onStatus(s)} className={`rounded px-2 py-1 text-xs font-semibold ${status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {s === "open" ? "Open" : s === "completed" ? "Completed" : "All"}
            </button>
          ))}
        </div>
      </div>
      {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {list.isError && <p className="text-sm text-destructive">{list.error.message}</p>}
      {!list.isPending && rows.length === 0 && <EmptyState title="No obligations here." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Aluminum owed / returned / remaining</TableHead>
                <TableHead className="text-right">Steel owed / returned / remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>{o.customer_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.aluminum_owed} / {o.aluminum_returned} / {o.aluminum_remaining}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.steel_owed} / {o.steel_returned} / {o.steel_remaining}</TableCell>
                  <TableCell>
                    <StatusBadge tone={o.status === "completed" ? "success" : "warning"}>{o.status === "completed" ? "COMPLETED" : "OPEN"}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => onOpen(o.id)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.hasNextPage && (
        <Button variant="outline" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

function RimDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useRimObligation(id);
  const { recordRimReturn } = useManagerMutations();
  const [alu, setAlu] = useState("");
  const [steel, setSteel] = useState("");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const o = q.data;

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!o) return <p className="text-sm text-destructive">{q.error?.message ?? "Not found."}</p>;

  function submit() {
    recordRimReturn.mutate(
      { obligationId: id, aluminum: Number(alu || 0), steel: Number(steel || 0), notes, requestId },
      {
        onSuccess: (next) => {
          toast.success(next.status === "completed" ? "Final return recorded. The obligation is completed." : "Return recorded.");
          setAlu("");
          setSteel("");
          setNotes("");
          setRequestId(crypto.randomUUID());
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back to obligations
      </Button>
      <section className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{o.customer_name}</h3>
          <StatusBadge tone={o.status === "completed" ? "success" : "warning"}>{o.status === "completed" ? "COMPLETED" : "OPEN"}</StatusBadge>
        </div>
        <p className="text-sm">Aluminum: owed {o.aluminum_owed}, returned {o.aluminum_returned}, <b>remaining {o.aluminum_remaining}</b></p>
        <p className="text-sm">Steel: owed {o.steel_owed}, returned {o.steel_returned}, <b>remaining {o.steel_remaining}</b></p>
        {o.notes && <p className="text-xs text-muted-foreground">{o.notes}</p>}
      </section>

      {o.status === "open" && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h4 className="text-sm font-semibold">Record a return</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Aluminum returned (max {o.aluminum_remaining})</Label>
              <Input inputMode="numeric" value={alu} onChange={(e) => setAlu(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Steel returned (max {o.steel_remaining})</Label>
              <Input inputMode="numeric" value={steel} onChange={(e) => setSteel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <Button disabled={recordRimReturn.isPending} onClick={submit}>
            {recordRimReturn.isPending ? "Saving…" : "Record return"}
          </Button>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Return history</h4>
        {o.returns.length === 0 && <p className="text-xs text-muted-foreground">No returns yet.</p>}
        {o.returns.map((r) => (
          <div key={r.id} className="rounded-md border border-border p-2 text-xs">
            <p className="font-medium">Aluminum {r.aluminum_returned} · Steel {r.steel_returned}</p>
            <p className="text-muted-foreground">{dateLabel(r.created_at.slice(0, 10))} · {r.notes || "no notes"}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
