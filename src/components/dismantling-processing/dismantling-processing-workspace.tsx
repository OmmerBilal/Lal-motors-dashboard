"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, Search, TriangleAlert, Wrench } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { roleLabels, type User } from "@/lib/types";
import { useDismantlingProcessingData } from "@/components/dismantling-processing/use-dismantling-data";
import { EmployeeDetail } from "@/components/dismantling-processing/employee-detail";
import { VehicleDismantlingDetail } from "@/components/dismantling-processing/vehicle-dismantling-detail";
import { NeedsReviewQueue } from "@/components/dismantling-processing/needs-review-queue";
import { CompletedTodayList } from "@/components/dismantling-processing/completed-today-list";

type View =
  | { name: "home" }
  | { name: "employee"; employeeId: string; employeeName: string }
  | { name: "vehicle"; vehicleId: string; back: View }
  | { name: "review" }
  | { name: "completed" };

export function DismantlingProcessingWorkspace({ user }: { user: User }) {
  const { roster, needsReviewCount, completedToday, todayCountForEmployee } = useDismantlingProcessingData();
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
    <div className="space-y-5 pb-10">
      <div className="-mx-4 -mt-6 border-b-4 border-accent-gold bg-brand px-4 py-4 text-brand-foreground sm:-mx-6 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.14em] text-brand-foreground/60 uppercase">LAL Motors</p>
            <h2 className="text-xl font-bold sm:text-2xl">Vehicle Dismantling Processing</h2>
            <p className="text-xs text-brand-foreground/70">Track People. Parts. Progress.</p>
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

      <div className={isSplit ? "lg:grid lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-6" : undefined}>
        <div className={view.name === "home" ? "space-y-5" : isSplit ? "hidden space-y-5 lg:block" : "hidden"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => setView({ name: "review" })}
              className={cn(
                "flex items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-left transition-colors hover:bg-destructive/10",
                view.name === "review" && "ring-2 ring-destructive/40"
              )}
            >
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <TriangleAlert className="size-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-destructive">Needs Review</span>
                <span className="block text-4xl font-bold text-destructive sm:text-5xl">{needsReviewCount}</span>
                <span className="block text-xs text-destructive/80">
                  {needsReviewCount} item{needsReviewCount === 1 ? "" : "s"} need review
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-destructive/60" />
            </button>

            <button
              onClick={() => setView({ name: "completed" })}
              className={cn(
                "flex items-center gap-4 rounded-xl border border-success/30 bg-success/5 p-6 text-left transition-colors hover:bg-success/10",
                view.name === "completed" && "ring-2 ring-success/40"
              )}
            >
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <ClipboardCheck className="size-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-success">Completed Today</span>
                <span className="block text-4xl font-bold text-success sm:text-5xl">{completedToday.length}</span>
                <span className="block text-xs text-success/80">cars completed</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-success/60" />
            </button>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Employee Activity Today</h3>
              <div className="relative w-full max-w-[220px]">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="pl-9" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {filteredRoster.map((person) => {
                const count = todayCountForEmployee(person.id);
                const selected = person.id === activeEmployeeId;
                return (
                  <button
                    key={person.id}
                    onClick={() => setView({ name: "employee", employeeId: person.id, employeeName: person.name })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/40",
                      selected && "border-primary bg-primary/5 ring-1 ring-primary/30"
                    )}
                  >
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                      {person.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{person.name.split(" ")[0]}</span>
                      <span className="block text-3xl leading-tight font-bold text-primary">{count}</span>
                      <span className="block text-xs text-muted-foreground">car{count === 1 ? "" : "s"} today</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
              {!filteredRoster.length && (
                <p className="col-span-full flex items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                  <Wrench className="size-4" /> No employees match that search.
                </p>
              )}
            </div>
          </div>
        </div>

        {view.name !== "home" && (
          <div className={isSplit ? "mt-5 lg:mt-0" : ""}>
            {view.name === "employee" && (
              <EmployeeDetail
                employeeId={view.employeeId}
                employeeName={view.employeeName}
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
              <CompletedTodayList onBack={() => setView({ name: "home" })} onOpenVehicle={(vehicleId) => openVehicle(vehicleId, view)} />
            )}

            {view.name === "vehicle" && <VehicleDismantlingDetail vehicleId={view.vehicleId} onBack={() => setView(view.back)} />}
          </div>
        )}
      </div>
    </div>
  );
}
