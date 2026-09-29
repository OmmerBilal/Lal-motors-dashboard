"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, Check, FileText, History, Search, UserPlus, UserRound, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSalesData } from "@/components/sales/sales-data-context";
import { mockExtractCustomerDocument } from "@/lib/mock/pos";
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
  const { customers } = useSalesData();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [q, setQ] = useState("");
  const [extracted, setExtracted] = useState<ReturnType<typeof mockExtractCustomerDocument> | null>(null);

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const query = q.toLowerCase();
    return customers
      .filter((c) => `${c.firstName} ${c.lastName} ${c.companyName} ${c.phone} ${c.email} ${c.customerNumber}`.toLowerCase().includes(query))
      .slice(0, 6);
  }, [customers, q]);

  const recent = useMemo(() => [...customers].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 4), [customers]);

  function scanDocument(fileName: string) {
    setExtracted(mockExtractCustomerDocument(fileName));
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">1. Customer</h3>

      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-md bg-muted p-1">
        <button
          onClick={() => setMode("existing")}
          className={`rounded px-2 py-1.5 text-xs font-semibold ${mode === "existing" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
        >
          Existing Customer
        </button>
        <button
          onClick={() => {
            setMode("new");
            onNewCustomer();
          }}
          className={`rounded px-2 py-1.5 text-xs font-semibold ${mode === "new" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
        >
          New Customer
        </button>
      </div>

      {selectedCustomer ? (
        <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-primary" />
              <div>
                <b className="block text-sm">{selectedCustomer.companyName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}</b>
                <small className="text-xs text-muted-foreground">{selectedCustomer.customerNumber}</small>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onSelectCustomer(null)}>
              Change
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{selectedCustomer.phone || "No phone"}</span>
            <span className="truncate">{selectedCustomer.email || "No email"}</span>
            <span className="col-span-2 truncate">{selectedCustomer.billingAddress || "No billing address"}</span>
            <span className="capitalize">{selectedCustomer.customerType}</span>
            <span className={selectedCustomer.taxStatus === "exempt" ? "font-semibold text-accent-gold-foreground" : ""}>
              {selectedCustomer.taxStatus === "exempt" ? "TAX EXEMPT" : "Taxable"}
            </span>
            <span className="col-span-2 flex items-center gap-1">
              <FileText className="size-3.5" />
              {selectedCustomer.documents.some((d) => d.type === "tax_document") ? "Tax document on file" : "No tax document"}
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
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8 text-sm" placeholder="Name, phone, company, ID or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/40"
              >
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-xs">{c.companyName || `${c.firstName} ${c.lastName}`}</b>
                  <small className="block truncate text-[11px] text-muted-foreground">
                    {c.customerNumber} · {c.phone}
                  </small>
                </span>
              </button>
            ))}
            {q.trim() && !matches.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching customer.</p>}
          </div>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onNewCustomer()}>
            <UserPlus className="size-3.5" /> New Customer
          </Button>
        </>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">Customer document / AI</p>
        <div className="flex flex-wrap gap-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary">
            <Camera className="size-3.5" /> Scan ID
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary">
            <Upload className="size-3.5" /> Upload File
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary">
            <Camera className="size-3.5" /> Take Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
        </div>
        {extracted && (
          <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs">
            <b className="block">AI-extracted (not saved)</b>
            <p className="mt-1 text-muted-foreground">{extracted.confidence}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
              <span>{extracted.firstName} {extracted.lastName}</span>
              <span>{extracted.phone}</span>
              <span className="col-span-2 truncate">{extracted.billingAddress}</span>
            </div>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  onNewCustomer({ firstName: extracted.firstName, lastName: extracted.lastName, phone: extracted.phone, billingAddress: extracted.billingAddress });
                  setExtracted(null);
                  toast.success("Extracted details loaded into a new customer form for review");
                }}
              >
                Use these details
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExtracted(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">Recent Customers</p>
        <div className="space-y-0.5">
          {recent.map((c) => (
            <button key={c.id} onClick={() => onSelectCustomer(c)} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent/40">
              <span className="truncate">{c.companyName || `${c.firstName} ${c.lastName}`}</span>
              <span className="text-muted-foreground">{c.customerNumber}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
