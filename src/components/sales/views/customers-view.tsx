"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useCustomerList } from "@/lib/query/customers";
import { useCustomersOutstanding } from "@/lib/query/sales";
import { listRowToCustomer } from "@/lib/data/customers";
import { usd } from "@/lib/mock/sales";

export function CustomersView({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  // Server-side search and keyset paging. Only the visible page of lightweight rows is held in memory.
  const list = useCustomerList(q);
  const results = useMemo(() => (list.data?.pages.flatMap((p) => p.rows) ?? []).map(listRowToCustomer), [list.data]);

  // list_customers carries no balance field, so each loaded row's balance is read from the same
  // customer_outstanding RPC the "receive payment" flow already uses — see useCustomersOutstanding.
  // This is one call per visible row (not one bulk call); bounded to the current page only.
  const { byId: balanceById } = useCustomersOutstanding(useMemo(() => results.map((c) => c.id), [results]));

  const visible = outstandingOnly ? results.filter((c) => (balanceById[c.id] ?? 0) > 0) : results;

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
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Name, phone, email, company, Customer ID or Tax ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button
          size="sm"
          variant={outstandingOnly ? "default" : "outline"}
          className="h-9 shrink-0"
          aria-pressed={outstandingOnly}
          onClick={() => setOutstandingOnly((v) => !v)}
        >
          <CircleDollarSign className="size-3.5" /> Outstanding only
        </Button>
      </div>
      {!list.isPending && visible.length === 0 && (
        <div className="p-6">
          <EmptyState icon={outstandingOnly ? CircleDollarSign : UserRound} title={outstandingOnly ? "No loaded customers have a balance." : "No customers match."} />
        </div>
      )}
      <div className="divide-y divide-border">
        {visible.map((c) => {
          const bal = balanceById[c.id];
          return (
            <button key={c.id} onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{c.companyName || `${c.firstName} ${c.lastName}`}</b>
                <small className="block truncate text-xs text-muted-foreground">
                  {c.customerNumber ? c.customerNumber + " · " : ""}{c.phone || "No phone"} · {c.email || "No email"}
                </small>
              </span>
              <span className="shrink-0 text-right">
                {bal === undefined ? (
                  <span className="text-xs text-muted-foreground/50">…</span>
                ) : bal > 0 ? (
                  <span className="inline-block rounded-md bg-tone-red/10 px-2 py-1 text-xs font-bold text-tone-red tabular-nums whitespace-nowrap">{usd(bal)}</span>
                ) : (
                  <span className="text-xs whitespace-nowrap text-muted-foreground">No balance</span>
                )}
              </span>
              <StatusBadge className="shrink-0" tone={c.taxStatus === "exempt" ? "brand" : "neutral"}>{c.taxStatus}</StatusBadge>
            </button>
          );
        })}
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
