"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

const tone = {
  blue: { bg: "bg-primary/8 border-primary/25", icon: "bg-primary/15 text-primary" },
  green: { bg: "bg-success/8 border-success/25", icon: "bg-success/15 text-success" },
  orange: { bg: "bg-warning/10 border-warning/30", icon: "bg-warning/20 text-warning-foreground" },
  purple: { bg: "bg-violet-500/8 border-violet-500/25", icon: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  grey: { bg: "bg-muted/60 border-border", icon: "bg-muted text-muted-foreground" },
  red: { bg: "bg-destructive/8 border-destructive/25", icon: "bg-destructive/15 text-destructive" },
} as const;

export type KpiTile = {
  key: string;
  tone: keyof typeof tone;
  icon: LucideIcon;
  label: string;
  value: string | number;
  subStats: { label: string; value: string | number }[];
  onClick?: () => void;
};

/** One row of coloured KPI cards — equal heights, consistent padding, 2-3 sub-stats each. */
export function KpiGrid({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => {
        const tn = tone[t.tone];
        const Comp = t.onClick ? "button" : "div";
        return (
          <Comp
            key={t.key}
            onClick={t.onClick}
            type={t.onClick ? "button" : undefined}
            className={cn("flex h-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors", tn.bg, t.onClick && "hover:brightness-95")}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tn.icon)}>
              <t.icon className="size-4.5" />
            </span>
            <div>
              <p className="text-2xl leading-tight font-bold tabular-nums">{t.value}</p>
              <p className="text-xs font-medium text-muted-foreground">{t.label}</p>
            </div>
            <div className="mt-auto flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              {t.subStats.map((s) => (
                <span key={s.label}>
                  <b className="text-foreground">{s.value}</b> {s.label}
                </span>
              ))}
            </div>
          </Comp>
        );
      })}
    </div>
  );
}
