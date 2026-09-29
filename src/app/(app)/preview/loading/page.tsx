"use client";

import { useState } from "react";
import { PreviewSubNav } from "@/components/shell/app-shell";
import { PartsWorkspace } from "@/components/parts/parts-workspace";
import { ContainersWorkspace } from "@/components/containers/containers-workspace";
import { useEffectiveUser } from "@/lib/effective-user";

const tabs = [
  { id: "parts", label: "Quick Part Capture" },
  { id: "containers", label: "My Loading Jobs" },
];

export default function PreviewLoadingPage() {
  const { user } = useEffectiveUser();
  const [tab, setTab] = useState("containers");

  return (
    <div>
      <PreviewSubNav items={tabs} active={tab} onChange={setTab} />
      {tab === "parts" && <PartsWorkspace user={user} />}
      {tab === "containers" && <ContainersWorkspace user={user} previewMode />}
    </div>
  );
}
