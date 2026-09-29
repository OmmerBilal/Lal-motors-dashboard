"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Boxes, CarFront, Container, Recycle, Wrench } from "lucide-react";
import type { User } from "@/lib/types";
import { mockUsers } from "@/lib/mock/users";
import { vehicleTitle } from "@/lib/mock/vehicles";
import { parts } from "@/lib/mock/parts";
import { containerJobs } from "@/lib/mock/containers";
import { scrapLoads, localDay } from "@/lib/mock/scrap";
import { computeExceptions, computeStageCounts, type VehicleStage } from "@/lib/mock/owner-dashboard";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { DashboardHeader } from "@/components/vehicles/owner-dashboard/dashboard-header";
import { VehicleStatusCards } from "@/components/vehicles/owner-dashboard/vehicle-status-cards";
import { KeyExceptionsPanel } from "@/components/vehicles/owner-dashboard/key-exceptions-panel";
import { KpiRow, type KpiItem } from "@/components/vehicles/owner-dashboard/kpi-row";
import { EmployeeOverview, type EmployeeCardData } from "@/components/vehicles/owner-dashboard/employee-overview";
import { RecentActivityTable, type ActivityRow } from "@/components/vehicles/owner-dashboard/recent-activity-table";
import { VehiclesByStageChart } from "@/components/vehicles/owner-dashboard/vehicles-by-stage-chart";

export function OwnerDashboard({
  user,
  onOpenVehicle,
  onGoList,
  onGoActivity,
}: {
  user: User;
  onOpenVehicle: (id: string) => void;
  onGoList: (filter: string) => void;
  onGoActivity: (actorId?: string, kind?: string) => void;
}) {
  const router = useRouter();
  const { vehicles, events, completionQueue, corrections } = useVehicleData();

  const stageCounts = useMemo(() => computeStageCounts(vehicles, events), [vehicles, events]);
  const exceptions = useMemo(() => computeExceptions(vehicles, events), [vehicles, events]);

  const kpis: KpiItem[] = useMemo(() => {
    const partsPulled = events.filter((e) => e.action === "PART_REMOVED").length;
    const converters = events.filter((e) => e.action === "PART_REMOVED" && e.partType?.toLowerCase().includes("converter")).length;
    const containersShipped = containerJobs.filter((j) => j.status === "Loaded" || j.status === "Completed").length;
    const scrapLoadCount = scrapLoads.length;
    return [
      { label: "Total Vehicles", value: vehicles.length, trend: "+3 this week", icon: CarFront },
      { label: "Total Parts Pulled", value: partsPulled, trend: "+12% vs last month", icon: Wrench },
      { label: "Total Converters", value: converters, trend: "Steady", icon: Recycle },
      { label: "Containers Shipped", value: containersShipped, trend: "This month", icon: Container },
      { label: "Scrap Loads", value: scrapLoadCount, trend: `${scrapLoads.filter((l) => l.loadDate === localDay()).length} today`, icon: Boxes },
    ];
  }, [vehicles, events]);

  const employees: EmployeeCardData[] = useMemo(() => {
    return mockUsers
      .filter((u) => u.role !== "owner")
      .map((u) => {
        const actions = events.filter((e) => e.actorId === u.id).length;
        const captured = parts.filter((p) => p.capturedByName === u.name).length;
        const loads = scrapLoads.filter((l) => l.driverId === u.id).length;
        const metrics =
          u.role === "scrap_driver"
            ? [{ label: "loads", value: loads }, { label: "actions", value: actions }]
            : u.role === "employee"
              ? [{ label: "captured", value: captured }, { label: "actions", value: actions }]
              : [{ label: "actions", value: actions }, { label: "captured", value: captured }];
        return { user: u, metrics: metrics.filter((m) => m.value > 0 || m.label === "actions") };
      });
  }, [events]);

  const activityRows: ActivityRow[] = useMemo(
    () =>
      [...events]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 8)
        .map((e) => {
          const vehicle = vehicles.find((v) => v.id === e.vehicleId);
          return {
            id: e.id,
            when: new Date(e.createdAt).toLocaleString(),
            employee: e.actorName,
            activity: e.action.replaceAll("_", " "),
            details: vehicle ? vehicleTitle(vehicle) : e.partType || e.note || "—",
            vehicleId: vehicle?.id,
          };
        }),
    [events, vehicles]
  );

  const notificationCount = completionQueue.length + corrections.length;

  function handleStageSelect(stage: VehicleStage) {
    const filterByStage: Record<VehicleStage, string> = {
      purchased: "all",
      inTransit: "awaitingArrival",
      arrived: "active",
      processing: "processing",
      waitingReview: "history",
      completed: "history",
    };
    onGoList(filterByStage[stage]);
  }

  function handleExceptionSelect(id: string) {
    if (id === "highValue" || id === "converters") return onGoActivity(undefined, id);
    if (id === "overdue") return onGoList("overdue");
    if (id === "needsAttention") return onGoList("needsAttention");
    onGoList("active");
  }

  return (
    <div>
      <DashboardHeader user={user} notificationCount={notificationCount} />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <VehicleStatusCards counts={stageCounts} onSelectStage={handleStageSelect} />
        <KeyExceptionsPanel rows={exceptions} onSelect={handleExceptionSelect} onViewAll={() => onGoList("overdue")} />
      </div>

      <div className="mb-4">
        <KpiRow items={kpis} />
      </div>

      <div className="mb-4">
        <EmployeeOverview employees={employees} onOpenEmployee={() => router.push("/team")} onViewAll={() => router.push("/team")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <RecentActivityTable rows={activityRows} onViewAll={() => onGoActivity()} onOpenVehicle={onOpenVehicle} />
        <VehiclesByStageChart counts={stageCounts} />
      </div>
    </div>
  );
}
