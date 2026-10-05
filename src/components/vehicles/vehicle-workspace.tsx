"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { vehicleTitle } from "@/lib/mock/vehicles";
import { useVehicleRecord } from "@/lib/query/vehicle-workspace";
import { HomeView } from "@/components/vehicles/views/home-view";
import { IntakeView } from "@/components/vehicles/views/intake-view";
import { ReviewView } from "@/components/vehicles/views/review-view";
import { ListView } from "@/components/vehicles/views/list-view";
import { ActivityView } from "@/components/vehicles/views/activity-view";
import { DetailView } from "@/components/vehicles/views/detail-view";
import { CompletionReviewView } from "@/components/vehicles/views/completion-review-view";
import { CompletionGroupView } from "@/components/vehicles/views/completion-group-view";
import { OwnerDashboard } from "@/components/vehicles/owner-dashboard/owner-dashboard";
import { INTAKE_HANDOFF_KEY } from "@/lib/ai/intake-handoff";

export type VehicleView =
  | "home"
  | "intake"
  | "review"
  | "list"
  | "activity"
  | "detail"
  | "completion-review"
  | "completion-group";

export type IntakeMethod = "bulk" | "single" | "scan" | "manual";

/** Reads one AI handoff. Pure read: the key is cleared by an effect after the screen has its value. */
function readIntakeHandoff(canIntake: boolean): { method: IntakeMethod; sourceText: string } | null {
  if (!canIntake || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(INTAKE_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { method: IntakeMethod; sourceText: string };
    return parsed.sourceText ? parsed : null;
  } catch {
    return null;
  }
}

/** Roles that may run the screenshot analysis (the analyze route checks the same list). */
const SCAN_ROLES = ["owner", "engineer_admin", "manager"];

/** Roles the intake RPCs accept. The screen shows intake to the same roles; the server decides again on every write. */
const INTAKE_ROLES = ["owner", "engineer_admin", "manager", "auction"];

function WorkspaceBody({ user, initialVehicleId }: { user: User; initialVehicleId?: string | null }) {
  const canIntake = INTAKE_ROLES.includes(user.role);

  // An AI candidate arrives as a handoff. It opens the same review as a paste: match preview, then a person confirms.
  const [handoff] = useState<{ method: IntakeMethod; sourceText: string } | null>(() => readIntakeHandoff(canIntake));
  const [view, setView] = useState<VehicleView>(initialVehicleId ? "detail" : handoff ? "review" : "home");
  const [filter, setFilter] = useState("active");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(initialVehicleId ?? null);
  const [intakeMethod, setIntakeMethod] = useState<IntakeMethod>("bulk");
  const [reviewDraftBatch, setReviewDraftBatch] = useState<{ method: IntakeMethod; sourceText: string } | null>(handoff);
  // Intake text survives Back from review and a round trip to another screen; it is cleared only on a successful commit.
  const [intakeSource, setIntakeSource] = useState("");
  useEffect(() => {
    if (!handoff) return;
    try {
      window.sessionStorage.removeItem(INTAKE_HANDOFF_KEY);
    } catch {
      /* storage unavailable: the handoff was already read */
    }
  }, [handoff]);
  const [completionPeriod, setCompletionPeriod] = useState<"week" | "month">("week");
  const [completionEmployeeId, setCompletionEmployeeId] = useState<string | null>(null);

  const recordQuery = useVehicleRecord(view === "detail" ? selectedVehicleId : null);
  const selectedVehicle = recordQuery.data?.record;
  const isOwnerHome = user.role === "owner" && view === "home";

  function openVehicle(id: string) {
    setSelectedVehicleId(id);
    setView("detail");
  }

  function goHome() {
    setView("home");
  }

  const heading =
    view === "detail"
      ? vehicleTitle(selectedVehicle ?? {})
      : view === "review"
        ? "AI Vehicle Review"
        : view === "intake"
          ? intakeMethod === "bulk"
            ? "Bulk Paste"
            : intakeMethod === "single"
              ? "Single Vehicle Paste"
              : intakeMethod === "scan"
                ? "AI Photo / Screenshot Scan"
                : "Manual Entry"
          : view === "list"
            ? "Vehicle Inventory"
            : view === "activity"
              ? "Vehicle Actions"
              : view === "completion-review"
                ? "Completion Review Queue"
                : view === "completion-group"
                  ? "Completed Vehicles"
                  : "Add Purchased Vehicles";

  const showGenericHeader = !isOwnerHome && !(view === "home" && canIntake);

  return (
    <div>
      {showGenericHeader && (
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Auction Vehicle Inventory
            </p>
            <h2 className="mt-1 text-xl font-semibold">{heading}</h2>
          </div>
          {view !== "home" && (
            <Button variant="outline" size="sm" onClick={goHome}>
              <ArrowLeft /> Back
            </Button>
          )}
        </div>
      )}

      {view === "home" && isOwnerHome && (
        <OwnerDashboard
          user={user}
          onOpenVehicle={openVehicle}
          onGoList={(f) => {
            setFilter(f);
            setEventTypeFilter("");
            setView("list");
          }}
          onGoActivity={(actorId, kind) => {
            setEventTypeFilter(kind || "");
            setView("activity");
          }}
        />
      )}

      {view === "home" && !isOwnerHome && (
        <HomeView
          user={user}
          canIntake={canIntake}
          onOpenVehicle={openVehicle}
          onStartIntake={(method) => {
            setIntakeMethod(method);
            setView("intake");
          }}
          onGoList={(f) => {
            setFilter(f);
            setEventTypeFilter("");
            setView("list");
          }}
          onGoActivity={(actorId, kind) => {
            setEventTypeFilter(kind || "");
            setView("activity");
          }}
          onGoCompletionReview={() => setView("completion-review")}
          onGoCompletionGroup={(period, employeeId) => {
            setCompletionPeriod(period);
            setCompletionEmployeeId(employeeId ?? null);
            setView("completion-group");
          }}
        />
      )}

      {view === "intake" && (
        <IntakeView
          method={intakeMethod}
          onChangeMethod={setIntakeMethod}
          canScan={SCAN_ROLES.includes(user.role)}
          initialSource={intakeSource}
          onSourceChange={setIntakeSource}
          onAnalyzed={(sourceText, method) => {
            const batchMethod = method ?? intakeMethod;
            setReviewDraftBatch({ method: batchMethod, sourceText });
            setView("review");
          }}
        />
      )}

      {view === "review" && reviewDraftBatch && (
        <>
          <Button variant="outline" size="sm" className="mb-3 min-h-11" onClick={() => setView("intake")}>
            <ArrowLeft /> Back to intake (text kept)
          </Button>
          <ReviewView batch={reviewDraftBatch} onDone={() => { setIntakeSource(""); setView("home"); }} onOpenVehicle={openVehicle} />
        </>
      )}

      {view === "list" && <ListView initialFilter={filter} onOpenVehicle={openVehicle} />}

      {view === "activity" && (
        <ActivityView onOpenVehicle={openVehicle} initialEventType={eventTypeFilter} />
      )}

      {view === "detail" && recordQuery.isPending && selectedVehicleId && (
        <p className="text-sm text-muted-foreground" aria-live="polite">Loading vehicle…</p>
      )}
      {view === "detail" && recordQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {recordQuery.error instanceof Error ? recordQuery.error.message : "This vehicle could not be opened."}
        </p>
      )}
      {view === "detail" && selectedVehicle && (
        <DetailView user={user} vehicle={selectedVehicle} />
      )}

      {view === "completion-review" && canIntake && (
        <CompletionReviewView onOpenVehicle={openVehicle} />
      )}

      {view === "completion-group" && (user.role === "owner" || user.role === "engineer_admin") && (
        <CompletionGroupView
          period={completionPeriod}
          employeeId={completionEmployeeId}
          onOpenVehicle={openVehicle}
          onChangeEmployee={setCompletionEmployeeId}
        />
      )}
    </div>
  );
}

export function VehicleWorkspace({ user, initialVehicleId }: { user: User; initialVehicleId?: string | null }) {
  return <WorkspaceBody user={user} initialVehicleId={initialVehicleId} />;
}
