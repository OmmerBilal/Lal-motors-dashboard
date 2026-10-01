"use client";

import { useState } from "react";
import { BadgePercent, Box, FileText, Package, Recycle, ShoppingCart, StickyNote, Trash2, Wallet, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StepHeader } from "@/components/sales/pos/step-header";
import { usd, type SaleItem } from "@/lib/mock/sales";
import { computePosTotals } from "@/lib/mock/pos";

const toneActiveClasses: Record<"blue" | "green", string> = {
  blue: "h-8 border border-primary/30 bg-primary/10 text-xs text-primary",
  green: "h-8 border border-success/30 bg-success/10 text-xs text-success",
};

function AmountPopoverButton({
  label,
  icon: Icon,
  value,
  onApply,
  tone = "blue",
}: {
  label: string;
  icon: typeof BadgePercent;
  value: number;
  onApply: (n: number) => void;
  tone?: "blue" | "green";
}) {
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
      <PopoverTrigger
        render={
          <Button variant={value > 0 ? "secondary" : "outline"} size="sm" className={value > 0 ? toneActiveClasses[tone] : "h-8 text-xs"} />
        }
      >
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
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <StepHeader
        step={3}
        icon={ShoppingCart}
        title="Current Sale"
        action={
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="icon-sm" title="Load Quote" aria-label="Load Quote" onClick={onLoadQuote}>
              <FileText className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Clear sale"
              aria-label="Clear sale"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onClearSale}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        }
      />

      <div className="max-h-56 flex-1 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className={`flex items-center gap-2 rounded-lg border p-2.5 ${item.manual ? "border-accent-rose/25 bg-accent-rose/5" : "border-border"}`}>
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-md ${item.manual ? "bg-accent-rose/20 text-accent-rose-foreground" : "bg-primary/10 text-primary"}`}>
              {item.manual ? <Box className="size-4" /> : <Package className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <b className="truncate text-xs">{item.description}</b>
                {item.manual && <span className="shrink-0 rounded bg-accent-rose/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-rose-foreground">MANUAL</span>}
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
            <button
              onClick={() => onRemove(item.id)}
              aria-label="Remove item"
              className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        {!items.length && <p className="py-6 text-center text-xs text-muted-foreground">No items yet — add from Find Parts or Manual Item.</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">
        <AmountPopoverButton label="Add Discount" icon={BadgePercent} value={discount} onApply={onSetDiscount} tone="blue" />
        <AmountPopoverButton label="Core Charge" icon={Recycle} value={coreCharge} onApply={onSetCoreCharge} tone="green" />
        <AmountPopoverButton label="Deposit" icon={WalletCards} value={depositApplied} onApply={onSetDeposit} tone="green" />
        <Button
          variant="outline"
          size="sm"
          className={notes ? "h-8 border-warning/30 bg-warning/10 text-xs text-warning-foreground" : "h-8 text-xs"}
          onClick={() => document.getElementById("sale-notes")?.focus()}
        >
          <StickyNote className="size-3.5" /> Note
        </Button>
      </div>

      <Textarea
        id="sale-notes"
        placeholder="Sale notes"
        rows={2}
        className={notes ? "mt-2.5 border-warning/30 bg-warning/5 text-sm" : "mt-2.5 text-sm"}
        value={notes}
        onChange={(e) => onSetNotes(e.target.value)}
      />

      <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/30 p-3.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <b className="tabular-nums">{usd(totals.subtotal)}</b>
        </div>
        {discount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <b className="tabular-nums text-destructive">-{usd(discount)}</b>
          </div>
        )}
        {coreCharge > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Core Charges</span>
            <b className="tabular-nums">{usd(coreCharge)}</b>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-muted-foreground">
            <BadgePercent className="size-3" /> Tax ({taxRate}%)
          </span>
          <b className="tabular-nums">{usd(totals.tax)}</b>
        </div>
        {depositApplied > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deposit / previous payment</span>
            <b className="tabular-nums text-success">-{usd(depositApplied)}</b>
          </div>
        )}
        {amountPaid > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount Paid</span>
            <b className="tabular-nums text-success">-{usd(amountPaid)}</b>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1.5 text-sm font-medium">
          <span className="text-foreground">Grand Total</span>
          <span className="tabular-nums">{usd(totals.grandTotal)}</span>
        </div>
        <div className="flex items-center justify-between rounded-md border border-primary/25 bg-primary/10 px-3 py-2.5 shadow-xs">
          <strong className="flex items-center gap-1.5 text-sm">
            <Wallet className="size-4 text-primary" /> Balance Due
          </strong>
          <b className="text-xl tabular-nums text-primary">{usd(totals.balanceDue)}</b>
        </div>
      </div>

      <Button variant="outline" className="mt-3" disabled={!items.length} onClick={onSaveQuote}>
        Save as Quote
      </Button>
    </div>
  );
}
