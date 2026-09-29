"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrapTracking } from "@/components/scrap/scrap-tracking";
import { useEffectiveUser } from "@/lib/effective-user";
import { mockUsers } from "@/lib/mock/users";

export default function PreviewScrapDriverPage() {
  const { user, realUser } = useEffectiveUser();
  const drivers = mockUsers.filter((u) => u.role === "scrap_driver");
  const [previewDriverId, setPreviewDriverId] = useState(realUser.id);

  return (
    <div>
      <div className="mb-4 max-w-sm space-y-1.5">
        <label className="text-sm font-semibold">Test as</label>
        <Select value={previewDriverId} onValueChange={(v) => setPreviewDriverId(v ?? realUser.id)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={realUser.id}>Owner test driver (no invitation needed)</SelectItem>
            {drivers.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ScrapTracking key={previewDriverId} user={user} previewMode previewDriverId={previewDriverId} />
    </div>
  );
}
