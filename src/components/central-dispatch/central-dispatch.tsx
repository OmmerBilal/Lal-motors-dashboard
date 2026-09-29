"use client";

import { useState } from "react";
import { Plus, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/lib/types";
import { DispatchDataProvider } from "@/components/central-dispatch/dispatch-data-context";
import { HomeView } from "@/components/central-dispatch/views/home-view";
import { IntakeReviewView, type IntakeMode } from "@/components/central-dispatch/views/intake-review-view";
import { CarrierView } from "@/components/central-dispatch/views/carrier-view";
import { AssignView } from "@/components/central-dispatch/views/assign-view";
import { JobView } from "@/components/central-dispatch/views/job-view";
import { ArrivalView } from "@/components/central-dispatch/views/arrival-view";

type View = "home" | "intake" | "carrier" | "assign" | "job" | "arrival";

function DispatchBody({ user }: { user: User }) {
  const canEdit = ["owner", "engineer_admin", "manager", "auction"].includes(user.role);
  const [view, setView] = useState<View>("home");
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("bulk");
  const [selected, setSelected] = useState<string[]>([]);
  const [redispatch, setRedispatch] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [arrivalVehicleId, setArrivalVehicleId] = useState<string | null>(null);

  function openJob(id: string) {
    setActiveJobId(id);
    setView("job");
  }

  function startArrival(vehicleId: string) {
    setArrivalVehicleId(vehicleId);
    setView("arrival");
  }

  return (
    <div>
      <div className="mb-1">
        <h2 className="text-xl font-semibold">Central Dispatch</h2>
        <p className="text-sm text-muted-foreground">One vehicle record from auction to yard</p>
      </div>

      <nav className="my-4 flex flex-wrap gap-2">
        {canEdit && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIntakeMode("bulk");
                setView("intake");
              }}
            >
              Paste Multiple Vehicles
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIntakeMode("scan");
                setView("intake");
              }}
            >
              <Upload /> Photo / Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIntakeMode("manual");
                setView("intake");
              }}
            >
              <Plus /> Manual Entry
            </Button>
            <Button variant="outline" size="sm" onClick={() => setView("carrier")}>
              + Add Carrier
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setRedispatch(false);
                setView("assign");
              }}
            >
              <Truck /> Create Dispatch
            </Button>
          </>
        )}
        <Button variant={view === "home" ? "default" : "outline"} size="sm" onClick={() => setView("home")}>
          Vehicles &amp; Deliveries
        </Button>
      </nav>

      {view === "home" && (
        <HomeView
          canEdit={canEdit}
          selected={selected}
          onSelectedChange={setSelected}
          onOpenJob={openJob}
          onArrive={startArrival}
          onCreateDispatch={() => {
            setRedispatch(false);
            setView("assign");
          }}
          onRedispatch={(vehicleId) => {
            setSelected([vehicleId]);
            setRedispatch(true);
            setView("assign");
          }}
        />
      )}

      {view === "intake" && (
        <IntakeReviewView mode={intakeMode} onDone={() => setView("home")} />
      )}

      {view === "carrier" && <CarrierView onSaved={() => setView("assign")} />}

      {view === "assign" && (
        <AssignView
          redispatch={redispatch}
          selected={selected}
          onAddCarrier={() => setView("carrier")}
          onDone={(jobId) => {
            setSelected([]);
            setRedispatch(false);
            openJob(jobId);
          }}
        />
      )}

      {view === "job" && activeJobId && (
        <JobView jobId={activeJobId} canEdit={canEdit} onArrive={startArrival} />
      )}

      {view === "arrival" && arrivalVehicleId && (
        <ArrivalView vehicleId={arrivalVehicleId} onDone={() => setView("home")} />
      )}
    </div>
  );
}

export function CentralDispatch({ user }: { user: User }) {
  return (
    <DispatchDataProvider>
      <DispatchBody user={user} />
    </DispatchDataProvider>
  );
}
