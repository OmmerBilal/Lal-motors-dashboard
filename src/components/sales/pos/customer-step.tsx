"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, Check, FileText, History, Search, ShieldCheck, UserPlus, UserRound, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepHeader } from "@/components/sales/pos/step-header";
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

  const hasTaxDoc = selectedCustomer?.documents.some((d) => d.type === "tax_document");

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5 shadow-xs">
      <StepHeader step={1} icon={UserRound} title="Customer" />

      <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-md bg-muted p-1">
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
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3.5" />
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
              <span className="text-muted-foreground">Billing</span>
              <span className="truncate font-medium">{selectedCustomer.billingAddress || "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">{selectedCustomer.customerType}</span>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${selectedCustomer.taxStatus === "exempt" ? "bg-accent-gold/25 text-accent-gold-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {selectedCustomer.taxStatus === "exempt" ? "TAX EXEMPT" : "Taxable"}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${hasTaxDoc ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
            >
              <FileText className="size-3" />
              {hasTaxDoc ? "Tax doc on file" : "No tax document"}
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
            <Input className="h-9 pl-8 text-sm" placeholder="Name, phone, company, ID or email" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <Button size="sm" className="mt-2.5 w-full" onClick={() => onNewCustomer()}>
            <UserPlus className="size-3.5" /> New Customer
          </Button>
        </>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <ShieldCheck className="size-3.5" /> Customer document / AI
        </p>
        <div className="flex flex-wrap gap-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10">
            <Camera className="size-3.5" /> Scan ID
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10">
            <Upload className="size-3.5" /> Upload File
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/10">
            <Camera className="size-3.5" /> Take Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && scanDocument(e.target.files[0].name)} />
          </label>
        </div>
        {extracted && (
          <div className="mt-2.5 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs">
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

      <div className="mt-5 border-t border-border pt-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Users className="size-3.5" /> Recent Customers
        </p>
        <div className="space-y-0.5">
          {recent.map((c) => (
            <button key={c.id} onClick={() => onSelectCustomer(c)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/40">
              <span className="truncate">{c.companyName || `${c.firstName} ${c.lastName}`}</span>
              <span className="text-muted-foreground">{c.customerNumber}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
