"use client";

import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns/empty-state";
import { usd, type SaleItem } from "@/lib/mock/sales";

export function ListPanel<T extends { id: string }>({
  title,
  rows,
  onOpen,
  getNumber,
  getSubtitle,
  getTotal,
}: {
  title: string;
  rows: T[];
  onOpen: (id: string) => void;
  getNumber: (r: T) => string;
  getSubtitle: (r: T) => string;
  getTotal: (r: T) => number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{rows.length} record(s)</p>
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <b className="block text-sm">{getNumber(r)}</b>
                <small className="text-xs text-muted-foreground">{getSubtitle(r)}</small>
              </span>
              <b className="text-sm">{usd(getTotal(r))}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-6">
          <EmptyState title={`No ${title.toLowerCase()} yet.`} />
        </div>
      )}
    </div>
  );
}

export function HistoryPanel<T extends { id: string }>({
  title,
  rows,
  onOpen,
  getNumber,
  getSubtitle,
  getTotal,
}: {
  title: string;
  rows: T[];
  onOpen?: (id: string) => void;
  getNumber: (r: T) => string;
  getSubtitle: (r: T) => string;
  getTotal: (r: T) => number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen?.(r.id)}
              disabled={!onOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left enabled:hover:bg-accent/30 disabled:cursor-default"
            >
              <span>
                <b className="block text-sm">{getNumber(r)}</b>
                <small className="text-xs text-muted-foreground">{getSubtitle(r)}</small>
              </span>
              <b className="text-sm">{usd(getTotal(r))}</b>
            </button>
          ))}
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No {title.toLowerCase()} yet.</p>
      )}
    </div>
  );
}

export function ItemsTable({ items }: { items: SaleItem[] }) {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {items.map((i) => (
        <div key={i.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 text-sm">
          <span>
            <b className="block">{i.stockSku}</b>
            <small className="text-xs text-muted-foreground">{i.description}</small>
          </span>
          <span className="text-xs text-muted-foreground">Qty {i.quantity}</span>
          <span className="text-xs text-muted-foreground">{usd(i.unitPrice)}</span>
          <b>{usd(i.quantity * i.unitPrice - (i.discount || 0))}</b>
        </div>
      ))}
    </div>
  );
}

export function QuoteItemsEditor({
  items,
  editable,
  onChange,
}: {
  items: SaleItem[];
  editable: boolean;
  onChange: (items: SaleItem[]) => void;
}) {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {items.map((i) => (
        <div key={i.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 text-sm">
          <span>
            <b className="block">{i.stockSku}</b>
            <small className="text-xs text-muted-foreground">{i.description}</small>
          </span>
          {editable ? (
            <Input
              aria-label="Quantity"
              type="number"
              min={1}
              max={i.manual ? undefined : i.availableQuantity}
              value={i.quantity}
              onChange={(e) => onChange(items.map((x) => (x.id === i.id ? { ...x, quantity: Number(e.target.value) } : x)))}
              className="h-8 w-20"
            />
          ) : (
            <span className="text-xs text-muted-foreground">Qty {i.quantity}</span>
          )}
          {editable ? (
            <Input
              aria-label="Unit price"
              type="number"
              min={0}
              step="0.01"
              value={i.unitPrice}
              onChange={(e) => onChange(items.map((x) => (x.id === i.id ? { ...x, unitPrice: Number(e.target.value) } : x)))}
              className="h-8 w-24"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{usd(i.unitPrice)}</span>
          )}
          <b>{usd(i.quantity * i.unitPrice - (i.discount || 0))}</b>
        </div>
      ))}
    </div>
  );
}

export function TotalsBlock({ subtotal, discount, tax, taxRate, total }: { subtotal: number; discount: number; tax: number; taxRate: number; total: number }) {
  return (
    <div className="mt-3 ml-auto max-w-xs space-y-1.5 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <b>{usd(subtotal)}</b>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Discount</span>
        <b>-{usd(discount)}</b>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Tax ({taxRate}%)</span>
        <b>{usd(tax)}</b>
      </div>
      <div className="flex justify-between border-t border-border pt-1.5 text-base">
        <strong>Total</strong>
        <b>{usd(total)}</b>
      </div>
    </div>
  );
}
