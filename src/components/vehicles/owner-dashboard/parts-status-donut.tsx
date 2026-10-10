"use client";

import type { PartsStatusCounts } from "@/lib/data/owner-dashboard";

const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 66;
const STROKE = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

const SEGMENTS: { key: keyof PartsStatusCounts; label: string; color: string }[] = [
  { key: "available", label: "Available", color: "var(--success)" },
  { key: "reserved", label: "Reserved", color: "var(--warning)" },
  { key: "sold", label: "Sold", color: "var(--muted-foreground)" },
];

/** "Parts Inventory Status" — same hand-rolled SVG donut approach as vehicles-by-stage-chart.tsx (this app's
 * one existing chart pattern), over real parts.operational_status counts (Available/Reserved/Sold). */
export function PartsStatusDonut({ counts }: { counts: PartsStatusCounts }) {
  const total = counts.available + counts.reserved + counts.sold;

  const segments = SEGMENTS.reduce<{ key: string; length: number; offset: number }[]>((acc, s) => {
    const count = counts[s.key];
    if (!total || !count) return acc;
    const length = (count / total) * CIRCUMFERENCE;
    const offset = acc.reduce((sum, x) => sum + x.length, 0);
    return [...acc, { key: s.key, length, offset }];
  }, []);

  return (
    <div className="h-full rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Parts Inventory Status</h3>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Parts inventory status donut chart" className="shrink-0">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {segments.map(({ key, length, offset }) => {
              const meta = SEGMENTS.find((s) => s.key === key)!;
              const count = counts[meta.key];
              const dashArray = `${Math.max(length - GAP, 0)} ${CIRCUMFERENCE - Math.max(length - GAP, 0)}`;
              return (
                <circle key={key} cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={meta.color} strokeWidth={STROKE} strokeDasharray={dashArray} strokeDashoffset={-offset}>
                  <title>{meta.label}: {count}</title>
                </circle>
              );
            })}
          </g>
          <text x={CENTER} y={CENTER - 2} textAnchor="middle" className="fill-foreground text-[24px] font-semibold">
            {total}
          </text>
          <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            Parts
          </text>
        </svg>

        <div className="w-full min-w-0 space-y-1.5">
          {SEGMENTS.map((s) => {
            const count = counts[s.key];
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={s.key} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
                <b className="tabular-nums">{count}</b>
                <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
