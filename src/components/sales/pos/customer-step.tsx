"use client";

import { useState } from "react";
import { Check, FileText, History, Search, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepHeader } from "@/components/sales/pos/step-header";
import { useCustomerList } from "@/lib/query/customers";
import { listRowToCustomer } from "@/lib/data/customers";
import type { Customer } from "@/lib/mock/sales";

export function CustomerStep({
  selectedCustomer,
  onSelectCustomer,
  onNewCustomer,
  onEditCustomer,
  onViewHistory,
}: {
  selectedCustomer: Customer | null;
  onSelectCustomer: (c: Customer | null) => void;
  onNewCustomer: (prefill?: Partial<Customer>) => void;
  onEditCustomer: () => void;
  onViewHistory: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [q, setQ] = useState("");
  // Server search. The list is keyset-paged; the sale picker only shows the first page of matches.
  const list = useCustomerList(q.trim());
  const matches = q.trim() ? (list.data?.pages[0]?.rows ?? []).slice(0, 6).map(listRowToCustomer) : [];

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader step={1} icon={UserRound} title="Customer" />

      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-md bg-muted p-1">
        <button
          onClick={() => setMode("existing")}
          className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors ${mode === "existing" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Existing Customer
        </button>
        <button
          onClick={() => {
            setMode("new");
            onNewCustomer();
          }}
          className={`rounded px-2 py-1.5 text-xs font-semibold transition-colors ${mode === "new" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          New Customer
        </button>
      </div>

      {selectedCustomer ? (
        <div className="rounded-lg border border-primary/35 bg-primary/6 p-3.5 shadow-xs">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Check className="size-4" />
              </span>
              <div>
                <b className="block text-sm leading-tight">{selectedCustomer.companyName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}</b>
                <small className="text-xs text-muted-foreground">{selectedCustomer.customerNumber}</small>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onSelectCustomer(null)}>
              Change
            </Button>
          </div>
          <div className="space-y-1.5 rounded-md bg-background/60 p-2.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-medium">{selectedCustomer.phone || "No phone"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate font-medium">{selectedCustomer.email || "No email"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">{selectedCustomer.customerType}</span>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              {selectedCustomer.taxStatus === "exempt" ? "Tax status on file: exempt. Sales still use the standard rate." : "Tax status on file: taxable."}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={onEditCustomer}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onViewHistory}>
              <History className="size-3.5" /> History
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8 text-sm" placeholder="Name, phone, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {list.isPending && q.trim() && <p className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</p>}
            {list.isError && <p className="px-2 py-1.5 text-xs text-destructive">{list.error.message}</p>}
            {matches.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/40"
              >
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-xs">{c.firstName}</b>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {c.customerNumber} · {c.phone}
                  </small>
                </span>
              </button>
            ))}
            {q.trim() && !list.isPending && !list.isError && !matches.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching customer.</p>}
          </div>
          <Button size="sm" className="mt-2.5 w-full" onClick={() => onNewCustomer()}>
            <UserPlus className="size-3.5" /> New Customer
          </Button>
        </>
      )}

      <div className="mt-4 border-t border-border pt-3.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="size-3.5" /> Customer ID scan and tax document upload are not connected yet.
        </p>
      </div>
    </div>
  );
}
