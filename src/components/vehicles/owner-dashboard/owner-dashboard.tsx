"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { CarFront, Cog, Container, Filter, Recycle } from "lucide-react";
import type { User } from "@/lib/types";
import { type VehicleStage } from "@/lib/mock/owner-dashboard";
import { useOwnerActivity, useOwnerEmployees, useOwnerSummary } from "@/lib/query/owner-dashboard";
import { DashboardHeader } from "@/components/vehicles/owner-dashboard/dashboard-header";
import { VehicleStatusCards } from "@/components/vehicles/owner-dashboard/vehicle-status-cards";
import { KeyExceptionsPanel } from "@/components/vehicles/owner-dashboard/key-exceptions-panel";
import { KpiRow, type KpiItem } from "@/components/vehicles/owner-dashboard/kpi-row";
import { EmployeeOverview, type EmployeeCardData } from "@/components/vehicles/owner-dashboard/employee-overview";
import { RecentActivityTable, type ActivityRow } from "@/components/vehicles/owner-dashboard/recent-activity-table";
import { VehiclesByStageChart } from "@/components/vehicles/owner-dashboard/vehicles-by-stage-chart";

const ZERO_STAGES: Record<VehicleStage, number> = { purchased: 0, inTransit: 0, arrived: 0, processing: 0, waitingReview: 0, completed: 0 };

/** Local calendar day as YYYY-MM-DD, for the server's range parameters. */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Owner Dashboard. Visuals are unchanged. Every number, exception, employee row and activity line comes from
 * the database read models (migration 0042) for the selected date range, which the server filters.
 */
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
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return { from, to };
  });
  const from = dateRange?.from ? ymd(dateRange.from) : "";
  const to = dateRange?.to ? ymd(dateRange.to) : from;

  const summary = useOwnerSummary(from, to);
  const employeesQ = useOwnerEmployees(from, to);
  const activityQ = useOwnerActivity(from, to);
  const s = summary.data;

  const stageCounts = s?.stage_counts ?? ZERO_STAGES;
  const exceptions = s?.exceptions ?? [];

  const kpis: KpiItem[] = useMemo(() => {
    const k = s?.kpis;
    const show = (n: number | undefined) => (summary.isError ? "—" : n ?? 0);
    return [
      { label: "Total Vehicles", value: show(k?.total_vehicles), trend: "All records", icon: CarFront },
      { label: "Total Parts Pulled", value: show(k?.parts_pulled), trend: "In selected range", icon: Cog },
      { label: "Total Converters", value: show(k?.converters), trend: "In selected range", icon: Filter },
      { label: "Containers Shipped", value: show(k?.containers_shipped), trend: "On the way or closed", icon: Container },
      { label: "Scrap Loads", value: show(k?.scrap_loads), trend: `${k?.scrap_loads_today ?? 0} today`, icon: Recycle },
    ];
  }, [s, summary.isError]);

  const employees: EmployeeCardData[] = useMemo(
    () =>
      (employeesQ.data ?? []).map((r) => {
        const user = { id: r.profile_id, name: r.name, role: r.role.split(", ")[0] || "employee" } as unknown as User;
        const metrics =
          user.role === "scrap_driver"
            ? [{ label: "loads", value: r.loads }, { label: "actions", value: r.actions }]
            : user.role === "employee"
              ? [{ label: "captured", value: r.captured }, { label: "actions", value: r.actions }]
              : [{ label: "actions", value: r.actions }, { label: "captured", value: r.captured }];
        return { user, metrics: metrics.filter((m) => m.value > 0 || m.label === "actions") };
      }),
    [employeesQ.data]
  );

  const activityRows: ActivityRow[] = useMemo(
    () =>
      (activityQ.data ?? []).map((e) => ({
        id: e.id,
        when: new Date(e.created_at).toLocaleString(),
        employee: e.actor_name,
        activity: e.action.replaceAll("_", " "),
        details: e.vehicle_title || e.part_type || e.note || "—",
        vehicleId: e.vehicle_id ?? undefined,
      })),
    [activityQ.data]
  );

  const notificationCount = s?.notification_count ?? 0;
  const loadError = summary.error ?? employeesQ.error ?? activityQ.error;

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
      <DashboardHeader user={user} notificationCount={notificationCount} dateRange={dateRange} onDateRangeChange={setDateRange} />

      {loadError && <p className="mb-4 text-sm text-destructive">{loadError.message}</p>}
      {(summary.isPending || employeesQ.isPending) && !loadError && <p className="mb-4 text-xs text-muted-foreground">Loading dashboard data…</p>}

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
        {/* min-w-0: the activity table scrolls inside its own container instead of widening the grid on phones */}
        <div className="min-w-0">
          <RecentActivityTable rows={activityRows} onViewAll={() => onGoActivity()} onOpenVehicle={onOpenVehicle} />
        </div>
        <div className="min-w-0">
          <VehiclesByStageChart counts={stageCounts} />
        </div>
      </div>
    </div>
  );
}
