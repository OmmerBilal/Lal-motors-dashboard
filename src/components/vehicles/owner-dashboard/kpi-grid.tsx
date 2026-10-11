"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

// Solid fills matching reference-images/dashboard reference image.jpeg (Vehicles=blue, Parts=green,
// Sales=orange, Containers=purple, Scrap=grey, Alerts=red), not light tints on a white card — this is
// the exact row shown in that reference, so it's the clearest proof the new palette actually renders.
const tone = {
  blue: "bg-tone-blue",
  green: "bg-tone-green",
  orange: "bg-tone-orange",
  purple: "bg-tone-purple",
  grey: "bg-tone-grey",
  red: "bg-tone-red",
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
        const Comp = t.onClick ? "button" : "div";
        return (
          <Comp
            key={t.key}
            onClick={t.onClick}
            type={t.onClick ? "button" : undefined}
            className={cn("flex h-full flex-col gap-2 rounded-xl p-4 text-left text-white shadow-sm transition-transform", tone[t.tone], t.onClick && "hover:brightness-95")}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20">
              <t.icon className="size-5" strokeWidth={2.25} />
            </span>
            <div>
              <p className="text-2xl leading-tight font-bold tabular-nums">{t.value}</p>
              <p className="text-xs font-medium text-white/85">{t.label}</p>
            </div>
            <div className="mt-auto flex flex-wrap gap-x-3 gap-y-0.5 border-t border-white/20 pt-2 text-[11px] text-white/75">
              {t.subStats.map((s) => (
                <span key={s.label}>
                  <b className="text-white">{s.value}</b> {s.label}
                </span>
              ))}
            </div>
          </Comp>
        );
      })}
    </div>
  );
}
