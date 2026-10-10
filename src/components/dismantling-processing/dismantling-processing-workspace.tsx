"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, Search, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { roleLabels, type User } from "@/lib/types";
import {
  periodPhrase,
  periodTitle,
  useDismantlingProcessingData,
  type PeriodId,
} from "@/components/dismantling-processing/use-dismantling-data";
import { EmployeeDetail } from "@/components/dismantling-processing/employee-detail";
import { VehicleDismantlingDetail } from "@/components/dismantling-processing/vehicle-dismantling-detail";
import { NeedsReviewQueue } from "@/components/dismantling-processing/needs-review-queue";
import { CompletedTodayList } from "@/components/dismantling-processing/completed-today-list";
import { VehicleWorkflow, VehicleRecordPanel } from "@/components/dismantling-processing/vehicle-workflow";

type View =
  | { name: "home" }
  | { name: "workflow" }
  | { name: "record"; vehicleId: string }
  | { name: "employee"; employeeId: string; employeeName: string }
  | { name: "vehicle"; vehicleId: string; back: View }
  | { name: "review" }
  | { name: "completed" };

export function DismantlingProcessingWorkspace({ user }: { user: User }) {
  // The date range selector lives inside EmployeeDetail (the right-hand panel), but is lifted here so the
  // left-hand "Completed" card and the per-employee "cars" counts below can be computed from the exact same
  // range/query instead of staying hard-coded to today while the detail panel shows a different range.
  const [period, setPeriod] = useState<PeriodId>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dataAnchor] = useState(() => Date.now());
  const { roster, needsReviewCount, completedInRange, countForEmployeeInRange } = useDismantlingProcessingData(
    period,
    { from: customFrom, to: customTo },
    dataAnchor
  );
  const [view, setView] = useState<View>({ name: "home" });
  const [search, setSearch] = useState("");
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const filteredRoster = useMemo(
    () => roster.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [roster, search]
  );

  function openVehicle(vehicleId: string, back: View) {
    setView({ name: "vehicle", vehicleId, back });
  }

  // Desktop shows a right-side detail panel (reference layout) while an employee — or a
  // vehicle opened from that employee's own list — is selected; the left roster stays visible.
  const activeEmployeeId =
    view.name === "employee" ? view.employeeId : view.name === "vehicle" && view.back.name === "employee" ? view.back.employeeId : null;
  const isSplit = activeEmployeeId !== null;

  return (
    <div className="space-y-4 pb-8">
      <div className="-mx-4 -mt-6 border-b-4 border-accent-gold bg-brand px-4 py-3 text-brand-foreground sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.14em] text-brand-foreground/60 uppercase">LAL Motors</p>
            <h2 className="text-lg font-bold sm:text-xl">Vehicle Dismantling Processing</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-brand-foreground/80 sm:block" suppressHydrationWarning>
              {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="flex items-center gap-2 rounded-full bg-brand-foreground/10 py-1 pr-3 pl-1 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-gold text-xs font-bold text-accent-gold-foreground">
                {user.name.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block leading-tight">{user.name}</span>
                <span className="block text-[10px] font-normal text-brand-foreground/70 leading-tight">{roleLabels[user.role]}</span>
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className={isSplit ? "lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-5" : undefined}>
        <div className={view.name === "home" ? "space-y-4" : isSplit ? "hidden space-y-4 lg:block" : "hidden"}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiLinkCard
              icon={Wrench}
              tone="primary"
              active={view.name === "workflow"}
              label="Vehicle Workflow"
              value="Ready · Assign"
              hint="Mark vehicles ready, assign one employee each"
              onClick={() => setView({ name: "workflow" })}
            />
            <KpiLinkCard
              icon={TriangleAlert}
              tone="destructive"
              active={view.name === "review"}
              label="Needs Review"
              value={needsReviewCount}
              hint={`${needsReviewCount} item${needsReviewCount === 1 ? "" : "s"} need review`}
              onClick={() => setView({ name: "review" })}
            />
            <KpiLinkCard
              icon={ClipboardCheck}
              tone="success"
              active={view.name === "completed"}
              label={`Completed ${periodTitle(period)}`}
              value={completedInRange.length}
              hint={`car${completedInRange.length === 1 ? "" : "s"} completed ${periodPhrase(period)}`}
              onClick={() => setView({ name: "completed" })}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Employee Activity · {periodTitle(period)}</h3>
              <div className="relative w-full max-w-[200px]">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="h-9 pl-8 text-sm" />
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredRoster.map((person) => {
                const count = countForEmployeeInRange(person.id);
                const selected = person.id === activeEmployeeId;
                return (
                  <button
                    key={person.id}
                    onClick={() => setView({ name: "employee", employeeId: person.id, employeeName: person.name })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/40",
                      selected && "border-primary bg-primary/5 ring-1 ring-primary/30"
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {person.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{person.name.split(" ")[0]}</span>
                      <span className="block text-xs text-muted-foreground">
                        <b className="text-base text-primary">{count}</b> car{count === 1 ? "" : "s"} {periodPhrase(period)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
              {!filteredRoster.length && (
                <p className="col-span-full flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground">
                  <Wrench className="size-4" /> No employees match that search.
                </p>
              )}
            </div>
          </div>
        </div>

        {view.name === "workflow" && (
          <div className="space-y-5">
            <button onClick={() => setView({ name: "home" })} className="text-sm font-semibold text-primary">← Back to dismantling overview</button>
            <VehicleWorkflow user={user} onOpenRecord={(vehicleId) => setView({ name: "record", vehicleId })} />
          </div>
        )}

        {view.name === "record" && (
          <VehicleRecordPanel user={user} vehicleId={view.vehicleId} onBack={() => setView({ name: "workflow" })} />
        )}

        {view.name !== "home" && view.name !== "workflow" && view.name !== "record" && (
          <div className={isSplit ? "mt-4 lg:mt-0" : ""}>
            {view.name === "employee" && (
              <EmployeeDetail
                employeeId={view.employeeId}
                employeeName={view.employeeName}
                period={period}
                onPeriodChange={setPeriod}
                customFrom={customFrom}
                customTo={customTo}
                onCustomFromChange={setCustomFrom}
                onCustomToChange={setCustomTo}
                anchorMs={dataAnchor}
                onBack={() => setView({ name: "home" })}
                onOpenVehicle={(vehicleId) => openVehicle(vehicleId, view)}
              />
            )}

            {view.name === "review" && (
              <NeedsReviewQueue
                user={user}
                onBack={() => setView({ name: "home" })}
                onOpenVehicle={(vehicleId) => openVehicle(vehicleId, view)}
              />
            )}

            {view.name === "completed" && (
              <CompletedTodayList
                period={period}
                custom={{ from: customFrom, to: customTo }}
                anchorMs={dataAnchor}
                onBack={() => setView({ name: "home" })}
                onOpenVehicle={(vehicleId) => openVehicle(vehicleId, view)}
              />
            )}

            {view.name === "vehicle" && <VehicleDismantlingDetail vehicleId={view.vehicleId} onBack={() => setView(view.back)} />}
          </div>
        )}
      </div>
    </div>
  );
}

const kpiTone: Record<string, { border: string; bg: string; icon: string; text: string; ring: string }> = {
  primary: { border: "border-primary/30", bg: "bg-primary/5 hover:bg-primary/10", icon: "bg-primary/15 text-primary", text: "text-primary", ring: "ring-primary/40" },
  destructive: { border: "border-destructive/30", bg: "bg-destructive/5 hover:bg-destructive/10", icon: "bg-destructive/15 text-destructive", text: "text-destructive", ring: "ring-destructive/40" },
  success: { border: "border-success/30", bg: "bg-success/5 hover:bg-success/10", icon: "bg-success/15 text-success", text: "text-success", ring: "ring-success/40" },
};

/** One shared template for the three top KPI buttons, so they always match in height, padding and type scale. */
function KpiLinkCard({
  icon: Icon,
  tone,
  active,
  label,
  value,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  tone: keyof typeof kpiTone;
  active: boolean;
  label: string;
  value: string | number;
  hint: string;
  onClick: () => void;
}) {
  const t = kpiTone[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-full items-center gap-3 rounded-xl border p-4 text-left transition-colors",
        t.border,
        t.bg,
        active && `ring-2 ${t.ring}`
      )}
    >
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", t.icon)}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs font-semibold", t.text)}>{label}</span>
        <span className="block text-2xl leading-tight font-bold">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className={cn("size-5 shrink-0", t.text, "opacity-60")} />
    </button>
  );
}
