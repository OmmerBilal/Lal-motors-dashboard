"use client";

import { stageMeta, stageOrder, type VehicleStage } from "@/lib/mock/owner-dashboard";

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 74;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 3;

export function VehiclesByStageChart({ counts }: { counts: Record<VehicleStage, number> }) {
  const total = stageOrder.reduce((sum, s) => sum + counts[s], 0);

  const segments = stageOrder.reduce<{ stage: VehicleStage; length: number; offset: number }[]>((acc, stage) => {
    const count = counts[stage];
    if (!total || !count) return acc;
    const length = (count / total) * CIRCUMFERENCE;
    const offset = acc.reduce((sum, s) => sum + s.length, 0);
    return [...acc, { stage, length, offset }];
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Vehicles by Stage</h3>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Vehicles by stage donut chart" className="shrink-0">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {segments.map(({ stage, length, offset }) => {
              const count = counts[stage];
              const meta = stageMeta[stage];
              const dashArray = `${Math.max(length - GAP, 0)} ${CIRCUMFERENCE - Math.max(length - GAP, 0)}`;
              const dashOffset = -offset;
              const pct = Math.round((count / total) * 100);
              return (
                <circle
                  key={stage}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={STROKE}
                  strokeDasharray={dashArray}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                >
                  <title>
                    {meta.label}: {count} ({pct}%)
                  </title>
                </circle>
              );
            })}
          </g>
          <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="fill-foreground text-[28px] font-semibold">
            {total}
          </text>
          <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            Vehicles
          </text>
        </svg>

        <div className="w-full min-w-0 space-y-1.5">
          {stageOrder.map((stage) => {
            const count = counts[stage];
            const meta = stageMeta[stage];
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={stage} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{meta.label}</span>
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
