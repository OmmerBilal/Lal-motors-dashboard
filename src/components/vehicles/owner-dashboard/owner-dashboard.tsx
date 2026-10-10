"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CarFront, Cog, Container, Recycle } from "lucide-react";
import type { User } from "@/lib/types";
import { type VehicleStage } from "@/lib/mock/owner-dashboard";
import { useOwnerActivity, useOwnerPartsStatus, useOwnerSalesByDay, useOwnerSummary, useOwnerTodaySales, useOwnerTopSellingParts } from "@/lib/query/owner-dashboard";
import { useExportCounts } from "@/lib/query/containers";
import { useManagerSummary } from "@/lib/query/scrap";
import { useDispatchCounts } from "@/lib/query/dispatch";
import { useArrivedTodayCount } from "@/lib/query/receiving";
import { cash } from "@/lib/mock/vehicles";
import { DashboardHeader } from "@/components/vehicles/owner-dashboard/dashboard-header";
import { WelcomeBanner } from "@/components/vehicles/owner-dashboard/welcome-banner";
import { KpiGrid, type KpiTile } from "@/components/vehicles/owner-dashboard/kpi-grid";
import { ActivityTimeline, type TimelineItem } from "@/components/vehicles/owner-dashboard/activity-timeline";
import { TransportStatusPanel } from "@/components/vehicles/owner-dashboard/transport-status-panel";
import { KeyExceptionsPanel } from "@/components/vehicles/owner-dashboard/key-exceptions-panel";
import { SalesOverviewChart } from "@/components/vehicles/owner-dashboard/sales-overview-chart";
import { PartsStatusDonut } from "@/components/vehicles/owner-dashboard/parts-status-donut";
import { TopSellingParts } from "@/components/vehicles/owner-dashboard/top-selling-parts";
import { DashboardFooter } from "@/components/vehicles/owner-dashboard/dashboard-footer";

const ZERO_STAGES: Record<VehicleStage, number> = { purchased: 0, inTransit: 0, arrived: 0, processing: 0, waitingReview: 0, completed: 0 };

/** Local calendar day as YYYY-MM-DD, for the server's range parameters. */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Owner Dashboard. Every tile is backed by a real read model — see the comment above each data hook below for
 * exactly which one, and src/lib/data/owner-dashboard.ts for the two tiles that read a table directly (no RPC
 * exists yet for parts-status / sales totals). Nothing on this page is invented.
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
  const today = ymd(new Date());
  const [salesDays, setSalesDays] = useState(7);

  // owner_dashboard_summary: stage_counts/exceptions/notification_count are always a live snapshot (not
  // date-ranged in the RPC itself); kpis.total_vehicles is likewise unranged. Passing "today" just satisfies
  // the RPC's required range parameter.
  const summary = useOwnerSummary(today, today);
  const activityQ = useOwnerActivity(today, today, 8);
  const exportCountsQ = useExportCounts();
  const scrapSummaryQ = useManagerSummary(today, today);
  const dispatchCountsQ = useDispatchCounts();
  const arrivedTodayQ = useArrivedTodayCount();
  const partsStatusQ = useOwnerPartsStatus();
  const todaySalesQ = useOwnerTodaySales();
  const salesByDayQ = useOwnerSalesByDay(salesDays);
  const topSellingQ = useOwnerTopSellingParts(30, 5);

  const s = summary.data;
  const stageCounts = s?.stage_counts ?? ZERO_STAGES;
  const exceptions = s?.exceptions ?? [];
  const notificationCount = s?.notification_count ?? 0;

  const loadError = summary.error ?? exportCountsQ.error ?? scrapSummaryQ.error ?? dispatchCountsQ.error;

  const kpis: KpiTile[] = useMemo(() => {
    const vehiclesInProgress = (s?.kpis.total_vehicles ?? 0) - stageCounts.completed;
    const ps = partsStatusQ.data;
    const ec = exportCountsQ.data;
    const scrap = scrapSummaryQ.data;
    return [
      {
        key: "vehicles",
        tone: "blue",
        icon: CarFront,
        label: "Vehicles in Progress",
        value: Math.max(0, vehiclesInProgress),
        subStats: [
          { label: "purchased", value: stageCounts.purchased },
          { label: "in transit", value: stageCounts.inTransit },
          { label: "processing", value: stageCounts.processing },
        ],
        onClick: () => onGoList("active"),
      },
      {
        key: "parts",
        tone: "green",
        icon: Cog,
        label: "Parts in Inventory",
        value: ps ? ps.available + ps.reserved : "—",
        subStats: [
          { label: "available", value: ps?.available ?? "—" },
          { label: "reserved", value: ps?.reserved ?? "—" },
        ],
        onClick: () => router.push("/parts"),
      },
      {
        key: "sales",
        tone: "orange",
        icon: Container,
        label: "Today's Sales",
        value: todaySalesQ.data ? cash(todaySalesQ.data.total) : "—",
        subStats: [{ label: "sales today", value: todaySalesQ.data?.count ?? "—" }],
        onClick: () => router.push("/sales"),
      },
      {
        key: "containers",
        tone: "purple",
        icon: Container,
        label: "Export Containers",
        value: ec ? ec.loading + ec.ready_for_invoice + ec.on_the_way : "—",
        subStats: [
          { label: "loading", value: ec?.loading ?? "—" },
          { label: "ready to invoice", value: ec?.ready_for_invoice ?? "—" },
          { label: "on the way", value: ec?.on_the_way ?? "—" },
        ],
        onClick: () => router.push("/containers"),
      },
      {
        key: "scrap",
        tone: "grey",
        icon: Recycle,
        label: "Scrap Inventory",
        value: scrap?.open_now ?? "—",
        subStats: [
          { label: "awaiting ticket", value: scrap?.awaiting_ticket_now ?? "—" },
          { label: "needs review", value: scrap?.needs_review_now ?? "—" },
        ],
        onClick: () => router.push("/scrap"),
      },
      {
        key: "alerts",
        tone: "red",
        icon: AlertTriangle,
        label: "Alerts",
        value: notificationCount,
        subStats: exceptions.filter((e) => e.count > 0).slice(0, 2).map((e) => ({ label: e.label.toLowerCase(), value: e.count })),
        onClick: () => onGoList("overdue"),
      },
    ];
  }, [s, stageCounts, partsStatusQ.data, exportCountsQ.data, scrapSummaryQ.data, todaySalesQ.data, notificationCount, exceptions, onGoList, router]);

  const timelineItems: TimelineItem[] = useMemo(
    () =>
      (activityQ.data ?? []).map((e) => ({
        id: e.id,
        time: new Date(e.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        title: e.action.replaceAll("_", " "),
        subtitle: `${e.actor_name} · ${e.vehicle_title || e.part_type || e.note || "—"}`,
        vehicleId: e.vehicle_id ?? undefined,
      })),
    [activityQ.data]
  );

  const transportCounts = {
    inTransit: dispatchCountsQ.data?.inTransit ?? 0,
    arrivingToday: arrivedTodayQ.data ?? 0,
    atYard: dispatchCountsQ.data?.arrived ?? 0,
    dispatched: dispatchCountsQ.data?.assigned ?? 0,
  };

  function handleExceptionSelect(id: string) {
    if (id === "highValue" || id === "converters") return onGoActivity(undefined, id);
    if (id === "overdue") return onGoList("overdue");
    if (id === "needsAttention") return onGoList("needsAttention");
    onGoList("active");
  }

  return (
    <div className="space-y-4">
      <DashboardHeader user={user} notificationCount={notificationCount} />
      <WelcomeBanner firstName={user.name.split(" ")[0]} />

      {loadError && <p className="text-sm text-destructive">{loadError.message}</p>}

      <KpiGrid tiles={kpis} />

      <div className="grid gap-4 lg:grid-cols-3">
        <ActivityTimeline items={timelineItems} onViewAll={() => onGoActivity()} onOpenVehicle={onOpenVehicle} />
        <TransportStatusPanel counts={transportCounts} />
        <KeyExceptionsPanel rows={exceptions} onSelect={handleExceptionSelect} onViewAll={() => onGoList("overdue")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SalesOverviewChart days={salesDays} onDaysChange={setSalesDays} points={salesByDayQ.data ?? []} />
        <PartsStatusDonut counts={partsStatusQ.data ?? { available: 0, reserved: 0, sold: 0 }} />
        <TopSellingParts parts={topSellingQ.data ?? []} />
      </div>

      <DashboardFooter />
    </div>
  );
}
