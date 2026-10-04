"use client";

import { History, Lock, Printer, ShieldOff, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** Only the actions that do real work. Exchange, layaway, register and manager tools are not connected yet. */
export function AdvancedActionsBar({
  overridePrice,
  onToggleOverridePrice,
  onVoidSale,
  onViewHistory,
  onPrintLastInvoice,
}: {
  overridePrice: boolean;
  onToggleOverridePrice: () => void;
  onVoidSale: () => void;
  onViewHistory: () => void;
  onPrintLastInvoice: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
      <span className="mr-1 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Advanced</span>

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onViewHistory}>
        <History className="size-3.5" /> Customer History
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onPrintLastInvoice}>
        <Printer className="size-3.5" /> Print Last Invoice
      </Button>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button
        size="sm"
        className={cn("h-7 px-2 text-xs", overridePrice ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-transparent text-muted-foreground hover:bg-accent")}
        onClick={onToggleOverridePrice}
      >
        {overridePrice ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} Override Price
      </Button>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onVoidSale}>
        <ShieldOff className="size-3.5" /> Clear Sale Screen
      </Button>
    </div>
  );
}
