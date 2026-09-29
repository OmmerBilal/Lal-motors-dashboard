"use client";

import { useState } from "react";
import { PreviewSubNav } from "@/components/shell/app-shell";
import { VehicleWorkspace } from "@/components/vehicles/vehicle-workspace";
import { CentralDispatch } from "@/components/central-dispatch/central-dispatch";
import { ScrapTracking } from "@/components/scrap/scrap-tracking";
import { useEffectiveUser } from "@/lib/effective-user";

const tabs = [
  { id: "vehicle-workspace", label: "Auction Vehicle Intake" },
  { id: "central-dispatch", label: "Central Dispatch" },
  { id: "scrap", label: "Scrap Loads" },
];

export default function PreviewAuctionPage() {
  const { user } = useEffectiveUser();
  const [tab, setTab] = useState("vehicle-workspace");

  return (
    <div>
      <PreviewSubNav items={tabs} active={tab} onChange={setTab} />
      {tab === "vehicle-workspace" && <VehicleWorkspace user={user} />}
      {tab === "central-dispatch" && <CentralDispatch user={user} />}
      {tab === "scrap" && <ScrapTracking user={user} />}
    </div>
  );
}
