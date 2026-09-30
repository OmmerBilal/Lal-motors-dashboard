"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

export function StepHeader({
  step,
  icon: Icon,
  title,
  tone = "primary",
  action,
}: {
  step?: number;
  icon: LucideIcon;
  title: string;
  tone?: "primary" | "success";
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
      <div className="flex items-center gap-2.5">
        {step && (
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              tone === "success" ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground"
            )}
          >
            {step}
          </span>
        )}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            tone === "success" ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="size-4" />
        </span>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      </div>
      {action}
    </div>
  );
}
