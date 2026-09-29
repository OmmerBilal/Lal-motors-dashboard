"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { vehicleTitle } from "@/lib/mock/vehicles";
import { VehicleDataProvider, useVehicleData } from "@/components/vehicles/vehicle-data-context";
import { HomeView } from "@/components/vehicles/views/home-view";
import { IntakeView } from "@/components/vehicles/views/intake-view";
import { ReviewView } from "@/components/vehicles/views/review-view";
import { ListView } from "@/components/vehicles/views/list-view";
import { ActivityView } from "@/components/vehicles/views/activity-view";
import { DetailView } from "@/components/vehicles/views/detail-view";
import { CompletionReviewView } from "@/components/vehicles/views/completion-review-view";
import { CompletionGroupView } from "@/components/vehicles/views/completion-group-view";

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

function WorkspaceBody({ user }: { user: User }) {
  const isYard = user.role === "yard";
  const canIntake = !isYard;
  const { getVehicle } = useVehicleData();

  const [view, setView] = useState<VehicleView>("home");
  const [filter, setFilter] = useState("active");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [intakeMethod, setIntakeMethod] = useState<IntakeMethod>("bulk");
  const [reviewDraftBatch, setReviewDraftBatch] = useState<{ method: IntakeMethod; sourceText: string } | null>(null);
  const [completionPeriod, setCompletionPeriod] = useState<"week" | "month">("week");
  const [completionEmployeeId, setCompletionEmployeeId] = useState<string | null>(null);

  const selectedVehicle = selectedVehicleId ? getVehicle(selectedVehicleId) : undefined;

  function openVehicle(id: string) {
    setSelectedVehicleId(id);
    setView("detail");
  }

  function goHome() {
    setView("home");
  }

  const heading =
    view === "detail"
      ? vehicleTitle(selectedVehicle || {})
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

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {isYard ? "Yard Vehicle Work" : "Auction Vehicle Intake"}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{heading}</h2>
        </div>
        {view !== "home" && (
          <Button variant="outline" size="sm" onClick={goHome}>
            <ArrowLeft /> Back
          </Button>
        )}
      </div>

      {view === "home" && (
        <HomeView
          user={user}
          canIntake={canIntake}
          isYard={isYard}
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
          onAnalyzed={(sourceText) => {
            setReviewDraftBatch({ method: intakeMethod, sourceText });
            setView("review");
          }}
        />
      )}

      {view === "review" && reviewDraftBatch && (
        <ReviewView batch={reviewDraftBatch} onDone={() => setView("home")} />
      )}

      {view === "list" && <ListView initialFilter={filter} onOpenVehicle={openVehicle} />}

      {view === "activity" && (
        <ActivityView onOpenVehicle={openVehicle} initialEventType={eventTypeFilter} />
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

export function VehicleWorkspace({ user }: { user: User }) {
  return (
    <VehicleDataProvider>
      <WorkspaceBody user={user} />
    </VehicleDataProvider>
  );
}
