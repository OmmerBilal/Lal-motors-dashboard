"use client";

import { useMemo, useState } from "react";
import { Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useCustomerList } from "@/lib/query/customers";
import { listRowToCustomer } from "@/lib/data/customers";

export function CustomersView({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  // Server-side search and keyset paging. Only the visible page of lightweight rows is held in memory.
  const list = useCustomerList(q);
  const results = useMemo(() => (list.data?.pages.flatMap((p) => p.rows) ?? []).map(listRowToCustomer), [list.data]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="text-sm font-semibold">Permanent Customer Database</h3>
          <p className="text-xs text-muted-foreground">Duplicate-protected and phone-normalized</p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus /> Add Customer
        </Button>
      </div>
      <div className="border-b border-border p-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Name, phone, email, company, Customer ID or Tax ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="divide-y divide-border">
        {results.map((c) => (
          <button key={c.id} onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm">{c.companyName || `${c.firstName} ${c.lastName}`}</b>
              <small className="text-xs text-muted-foreground">
                {c.customerNumber} · {c.phone || "No phone"} · {c.email || "No email"}
              </small>
            </span>
            <StatusBadge tone={c.taxStatus === "exempt" ? "brand" : "neutral"}>{c.taxStatus}</StatusBadge>
          </button>
        ))}
      </div>
      {list.hasNextPage && (
        <div className="border-t border-border p-3">
          <Button variant="outline" size="sm" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Loading…" : "Load more customers"}
          </Button>
        </div>
      )}
    </div>
  );
}
