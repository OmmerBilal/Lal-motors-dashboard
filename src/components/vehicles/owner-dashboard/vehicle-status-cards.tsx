"use client";

import { CarFront, CheckCircle2, ClipboardCheck, MapPin, Truck, Wrench } from "lucide-react";
import { stageMeta, stageOrder, type VehicleStage } from "@/lib/mock/owner-dashboard";

const stageIcon: Record<VehicleStage, typeof CarFront> = {
  purchased: CarFront,
  inTransit: Truck,
  arrived: MapPin,
  processing: Wrench,
  waitingReview: ClipboardCheck,
  completed: CheckCircle2,
};

export function VehicleStatusCards({
  counts,
  onSelectStage,
}: {
  counts: Record<VehicleStage, number>;
  onSelectStage: (stage: VehicleStage) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stageOrder.map((stage) => {
        const meta = stageMeta[stage];
        const Icon = stageIcon[stage];
        return (
          <button
            key={stage}
            onClick={() => onSelectStage(stage)}
            className="flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/30"
            style={{ backgroundColor: `${meta.color}14` }}
          >
            <span className="flex size-9 items-center justify-center rounded-md" style={{ backgroundColor: `${meta.color}26`, color: meta.color }}>
              <Icon className="size-5" />
            </span>
            <span className="text-2xl leading-none font-semibold tabular-nums">{counts[stage]}</span>
            <span className="text-sm font-semibold">{meta.label}</span>
            <span className="text-xs text-muted-foreground">{meta.subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}
