"use client";

import { useState } from "react";
import { FileDown, Package, Percent, PiggyBank, StickyNote, Trash2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usd, type SaleItem } from "@/lib/mock/sales";
import { computePosTotals } from "@/lib/mock/pos";

function AmountPopoverButton({ label, icon: Icon, value, onApply }: { label: string; icon: typeof Percent; value: number; onApply: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value || ""));

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setDraft(String(value || ""));
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8 text-xs" />}>
        <Icon className="size-3.5" /> {label}
        {value > 0 && <span className="ml-0.5 font-semibold">({usd(value)})</span>}
      </PopoverTrigger>
      <PopoverContent className="w-48" align="start">
        <p className="mb-1.5 text-xs font-semibold">{label}</p>
        <Input type="number" min={0} step="0.01" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 text-sm" autoFocus />
        <div className="mt-2 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(Math.max(0, Number(draft) || 0));
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CurrentSaleStep({
  items,
  onUpdateQuantity,
  onRemove,
  discount,
  coreCharge,
  depositApplied,
  notes,
  taxRate,
  amountPaid,
  onSetDiscount,
  onSetCoreCharge,
  onSetDeposit,
  onSetNotes,
  onClearSale,
  onSaveQuote,
  onLoadQuote,
  overridePrice = false,
  onUpdatePrice,
}: {
  items: SaleItem[];
  onUpdateQuantity: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  discount: number;
  coreCharge: number;
  depositApplied: number;
  notes: string;
  taxRate: number;
  amountPaid: number;
  onSetDiscount: (n: number) => void;
  onSetCoreCharge: (n: number) => void;
  onSetDeposit: (n: number) => void;
  onSetNotes: (s: string) => void;
  onClearSale: () => void;
  onSaveQuote: () => void;
  onLoadQuote: () => void;
  overridePrice?: boolean;
  onUpdatePrice?: (id: string, price: number) => void;
}) {
  const totals = computePosTotals({ items, discount, coreCharge, taxRate, depositApplied, amountPaid });

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">3. Current Sale</h3>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onLoadQuote}>
            <FileDown className="size-3.5" /> Load Quote
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={onClearSale}>
            <Trash2 className="size-3.5" /> Clear
          </Button>
        </div>
      </div>

      <div className="max-h-56 flex-1 space-y-1.5 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-md border border-border p-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              {item.manual ? <Wrench className="size-4" /> : <Package className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <b className="truncate text-xs">{item.description}</b>
                {item.manual && <span className="shrink-0 rounded bg-accent-gold/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-gold-foreground">MANUAL</span>}
              </div>
              <small className="text-[11px] text-muted-foreground">{item.stockSku}</small>
            </div>
            <Input
              aria-label="Quantity"
              type="number"
              min={1}
              max={item.manual ? undefined : item.availableQuantity}
              value={item.quantity}
              onChange={(e) => onUpdateQuantity(item.id, Number(e.target.value))}
              className="h-7 w-14 text-xs"
            />
            {overridePrice ? (
              <Input
                aria-label="Unit price"
                type="number"
                min={0}
                step="0.01"
                value={item.unitPrice}
                onChange={(e) => onUpdatePrice?.(item.id, Number(e.target.value))}
                className="h-7 w-20 text-xs"
              />
            ) : (
              <b className="w-16 shrink-0 text-right text-xs">{usd(item.quantity * item.unitPrice)}</b>
            )}
            <button onClick={() => onRemove(item.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
              <X className="size-4" />
            </button>
          </div>
        ))}
        {!items.length && <p className="py-6 text-center text-xs text-muted-foreground">No items yet — add from Find Parts or Manual Item.</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        <AmountPopoverButton label="Add Discount" icon={Percent} value={discount} onApply={onSetDiscount} />
        <AmountPopoverButton label="Core Charge" icon={PiggyBank} value={coreCharge} onApply={onSetCoreCharge} />
        <AmountPopoverButton label="Deposit" icon={PiggyBank} value={depositApplied} onApply={onSetDeposit} />
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => document.getElementById("sale-notes")?.focus()}>
          <StickyNote className="size-3.5" /> Note
        </Button>
      </div>

      <Textarea id="sale-notes" placeholder="Sale notes" rows={2} className="mt-2 text-sm" value={notes} onChange={(e) => onSetNotes(e.target.value)} />

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <b>{usd(totals.subtotal)}</b>
        </div>
        {discount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <b className="text-destructive">-{usd(discount)}</b>
          </div>
        )}
        {coreCharge > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Core Charges</span>
            <b>{usd(coreCharge)}</b>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax ({taxRate}%)</span>
          <b>{usd(totals.tax)}</b>
        </div>
        {depositApplied > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deposit / previous payment</span>
            <b>-{usd(depositApplied)}</b>
          </div>
        )}
        {amountPaid > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount Paid</span>
            <b className="text-success">-{usd(amountPaid)}</b>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1.5 text-xs text-muted-foreground">
          <span>Grand Total</span>
          <span>{usd(totals.grandTotal)}</span>
        </div>
        <div className="flex justify-between text-base">
          <strong>Balance Due</strong>
          <b>{usd(totals.balanceDue)}</b>
        </div>
      </div>

      <Button variant="outline" size="sm" className="mt-3" disabled={!items.length} onClick={onSaveQuote}>
        Save as Quote
      </Button>
    </div>
  );
}
