"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

// Calm accent-tinted tiles — a pale tint background, a bold tone-coloured number, and a small solid
// icon chip as the one pop of colour. A fully-saturated solid-fill card (tried in an earlier pass)
// read as loud; this matches what every reference-images/*.jpeg KPI card actually looks like.
const tone = {
  blue: { card: "bg-tone-blue/8 border-tone-blue/20", value: "text-tone-blue", chip: "bg-tone-blue" },
  green: { card: "bg-tone-green/8 border-tone-green/20", value: "text-tone-green", chip: "bg-tone-green" },
  orange: { card: "bg-tone-orange/10 border-tone-orange/25", value: "text-tone-orange", chip: "bg-tone-orange" },
  purple: { card: "bg-tone-purple/8 border-tone-purple/20", value: "text-tone-purple", chip: "bg-tone-purple" },
  grey: { card: "bg-muted/60 border-border", value: "text-foreground", chip: "bg-muted-foreground" },
  red: { card: "bg-tone-red/8 border-tone-red/20", value: "text-tone-red", chip: "bg-tone-red" },
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
            className={cn("flex h-full flex-col gap-2 rounded-xl border p-4 text-left shadow-xs transition-colors", tn.card, t.onClick && "hover:brightness-95")}
          >
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-white", tn.chip)}>
              <t.icon className="size-5" strokeWidth={2.25} />
            </span>
            <div>
              <p className={cn("text-2xl leading-tight font-bold tabular-nums", tn.value)}>{t.value}</p>
              <p className="text-xs font-medium text-foreground/80">{t.label}</p>
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
