"use client";

import { MoreHorizontal, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/patterns/status-badge";
import {
  cash,
  computeTransportDays,
  lotOrStockDisplay,
  transportStatusLabels,
  transportStatusTone,
  type VehicleRecord,
} from "@/lib/mock/vehicles";

export function DispatchTable({
  vehicles,
  selected,
  onToggle,
  onToggleAll,
  onView,
  onReportProblem,
  onAdvance,
}: {
  vehicles: VehicleRecord[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onView: (v: VehicleRecord) => void;
  onReportProblem: (v: VehicleRecord) => void;
  onAdvance: (v: VehicleRecord) => void;
}) {
  const allSelected = vehicles.length > 0 && vehicles.every((v) => selected.includes(v.id));

  const advanceLabel: Partial<Record<VehicleRecord["transportStatus"], string>> = {
    ASSIGNED: "Mark Picked Up",
    IN_TRANSIT: "Mark Arrived",
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[1080px] text-sm">
        <thead className="bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th className="w-9 p-2.5">
              <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all" />
            </th>
            <th className="p-2.5">Vehicle</th>
            <th className="p-2.5">VIN</th>
            <th className="p-2.5">Stock # / Lot #</th>
            <th className="p-2.5">PIN #</th>
            <th className="p-2.5">Purchase Date</th>
            <th className="p-2.5">Pickup Location</th>
            <th className="p-2.5">Transport Price</th>
            <th className="p-2.5">Carrier / Company</th>
            <th className="p-2.5">Status</th>
            <th className="p-2.5">Days</th>
            <th className="p-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {vehicles.map((v) => (
            <tr key={v.id} className="hover:bg-accent/20">
              <td className="p-2.5">
                <Checkbox checked={selected.includes(v.id)} onCheckedChange={() => onToggle(v.id)} aria-label={`Select ${v.vin || v.id}`} />
              </td>
              <td className="p-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Package className="size-4" />
                  </span>
                  <span className="whitespace-nowrap">
                    {v.year} {v.make} {v.model}
                  </span>
                </div>
              </td>
              <td className="p-2.5 font-mono text-xs whitespace-nowrap">{v.vin || "—"}</td>
              <td className="p-2.5 whitespace-nowrap">{lotOrStockDisplay(v)}</td>
              <td className="p-2.5 whitespace-nowrap">{v.pickupPin || "—"}</td>
              <td className="p-2.5 whitespace-nowrap">{v.saleDate || "—"}</td>
              <td className="p-2.5 whitespace-nowrap">{v.pickupLocationName || "—"}</td>
              <td className="p-2.5 whitespace-nowrap">{v.transportPrice ? cash(v.transportPrice) : "—"}</td>
              <td className="p-2.5 whitespace-nowrap">
                {v.carrierName ? <span className="text-primary">{v.carrierName}</span> : "Not Assigned"}
              </td>
              <td className="p-2.5">
                <StatusBadge tone={transportStatusTone[v.transportStatus]}>{transportStatusLabels[v.transportStatus]}</StatusBadge>
              </td>
              <td className="p-2.5 tabular-nums">{computeTransportDays(v)}</td>
              <td className="p-2.5">
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onView(v)}>
                    View
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button size="icon-sm" variant="ghost" aria-label="More actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {advanceLabel[v.transportStatus] && (
                        <DropdownMenuItem onClick={() => onAdvance(v)}>{advanceLabel[v.transportStatus]}</DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onClick={() => onReportProblem(v)}>
                        Report Problem
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
