"use client";

import { toast } from "sonner";
import {
  ArrowLeftRight,
  History,
  Lock,
  Printer,
  Settings,
  ShieldOff,
  Timer,
  Unlock,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
      <span className="mr-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Advanced</span>
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
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Register opened")}>
        <UserCog className="size-3.5" /> Open Register
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("End of day summary generated")}>
        <Timer className="size-3.5" /> End of Day
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Manager tools require a PIN")}>
        <UserCog className="size-3.5" /> Manager Tools
      </Button>
      <Button variant={overridePrice ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={onToggleOverridePrice}>
        {overridePrice ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} Override Price
      </Button>
      <Button variant={taxExempt ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={onToggleTaxExempt}>
        <ShieldOff className="size-3.5" /> Tax Exempt
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={onVoidSale}>
        <ShieldOff className="size-3.5" /> Void Sale
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => mock("Settings")}>
        <Settings className="size-3.5" /> Settings
      </Button>
    </div>
  );
}
