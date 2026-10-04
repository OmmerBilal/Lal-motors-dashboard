"use client";

import { RotateCcw } from "lucide-react";

/** Returns and refunds need their own module. Nothing is recorded or refunded from this screen yet. */
export function ReturnsPanel() {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-left shadow-xs">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <RotateCcw className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1 text-xs leading-tight font-semibold text-muted-foreground">
        Returns &amp; refunds
        <br />
        Not connected yet
      </span>
    </div>
  );
}
