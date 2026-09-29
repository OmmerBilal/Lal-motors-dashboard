"use client";

import { useState } from "react";
import { PreviewSubNav } from "@/components/shell/app-shell";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { CentralDispatch } from "@/components/central-dispatch/central-dispatch";
import { PartsWorkspace } from "@/components/parts/parts-workspace";
import { OperationsView } from "@/components/parts/operations-view";
import { SalesWorkspace } from "@/components/sales/sales-workspace";
import { ContainersWorkspace } from "@/components/containers/containers-workspace";
import { ScrapTracking } from "@/components/scrap/scrap-tracking";
import { useEffectiveUser } from "@/lib/effective-user";

const tabs = [
  { id: "vehicle-workspace", label: "Vehicle Operations" },
  { id: "central-dispatch", label: "Central Dispatch" },
  { id: "parts", label: "Pending Parts & Inventory" },
  { id: "operations", label: "Parts Operations" },
  { id: "sales", label: "Customers & Sales" },
  { id: "containers", label: "Containers & Export" },
  { id: "scrap", label: "Scrap Loads" },
];

export default function PreviewFrontDeskPage() {
  const { user } = useEffectiveUser();
  const [tab, setTab] = useState("vehicle-workspace");

  return (
    <div>
      <PreviewSubNav items={tabs} active={tab} onChange={setTab} />
      {tab === "vehicle-workspace" && <VehicleWorkspace user={user} />}
      {tab === "central-dispatch" && <CentralDispatch user={user} />}
      {tab === "parts" && <PartsWorkspace user={user} />}
      {tab === "operations" && <OperationsView />}
      {tab === "sales" && <SalesWorkspace user={user} />}
      {tab === "containers" && <ContainersWorkspace user={user} />}
      {tab === "scrap" && <ScrapTracking user={user} />}
    </div>
  );
}
