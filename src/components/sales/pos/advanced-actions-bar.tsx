"use client";

import { toast } from "sonner";
import {
  ArrowLeftRight,
  BarChart3,
  History,
  Lock,
  Printer,
  Settings,
  Shield,
  ShieldOff,
  Timer,
  Unlock,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function AdvancedActionsBar({
  taxExempt,
  onToggleTaxExempt,
  overridePrice,
  onToggleOverridePrice,
  onVoidSale,
  onViewHistory,
}: {
  taxExempt: boolean;
  onToggleTaxExempt: () => void;
  overridePrice: boolean;
  onToggleOverridePrice: () => void;
  onVoidSale: () => void;
  onViewHistory: () => void;
}) {
  function mock(label: string) {
    toast.info(`${label} — mocked for this UI-only phase`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
      <span className="mr-1 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Advanced</span>

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Exchange")}>
        <ArrowLeftRight className="size-3.5" /> Exchange
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Layaway / Hold saved")}>
        <Timer className="size-3.5" /> Layaway / Hold
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onViewHistory}>
        <History className="size-3.5" /> Customer History
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => window.print()}>
        <Printer className="size-3.5" /> Print Last Invoice
      </Button>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Register opened")}>
        <UserCog className="size-3.5" /> Open Register
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("End of day summary generated")}>
        <BarChart3 className="size-3.5" /> End of Day
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-indigo-600 hover:bg-indigo-500/10 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-400"
        onClick={() => mock("Manager tools require a PIN")}
      >
        <Shield className="size-3.5" /> Manager Tools
      </Button>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button
        size="sm"
        className={cn("h-7 px-2 text-xs", overridePrice ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-transparent text-muted-foreground hover:bg-accent")}
        onClick={onToggleOverridePrice}
      >
        {overridePrice ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} Override Price
      </Button>
      <Button
        size="sm"
        className={cn("h-7 px-2 text-xs", taxExempt ? "bg-accent-gold text-accent-gold-foreground hover:bg-accent-gold/90" : "bg-transparent text-muted-foreground hover:bg-accent")}
        onClick={onToggleTaxExempt}
      >
        <ShieldOff className="size-3.5" /> Tax Exempt
      </Button>

      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onVoidSale}>
        <ShieldOff className="size-3.5" /> Void Sale
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Settings")}>
        <Settings className="size-3.5" /> Settings
      </Button>
    </div>
  );
}
