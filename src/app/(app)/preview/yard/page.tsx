"use client";

import { useState } from "react";
import { PreviewSubNav } from "@/components/shell/app-shell";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { CentralDispatch } from "@/components/central-dispatch/central-dispatch";
import { useEffectiveUser } from "@/lib/effective-user";

const tabs = [
  { id: "vehicle-workspace", label: "Yard Vehicle Work" },
  { id: "central-dispatch", label: "Central Dispatch" },
];

export default function PreviewYardPage() {
  const { user } = useEffectiveUser();
  const [tab, setTab] = useState("vehicle-workspace");

  return (
    <div>
      <PreviewSubNav items={tabs} active={tab} onChange={setTab} />
      {tab === "vehicle-workspace" && <VehicleWorkspace user={user} />}
      {tab === "central-dispatch" && <CentralDispatch user={user} />}
    </div>
  );
}
