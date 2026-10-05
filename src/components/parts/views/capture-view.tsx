"use client";

import { WifiOff } from "lucide-react";

/**
 * Warehouse part capture is not connected. A part photo can only be attached to an existing part record, and
 * warehouse capture does not create one yet. The picker that used to store a file name is removed: nothing here
 * uploads, saves or shows a photo. Captures from vehicles are made in Dismantling.
 */
export function CaptureView() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 rounded-lg border border-border bg-card p-6 text-center">
      <WifiOff className="mx-auto size-8 text-muted-foreground" />
      <b className="block text-lg font-semibold">Warehouse part capture: Not Connected</b>
      <p className="text-sm text-muted-foreground">
        Nothing can be captured here yet. Parts are captured from vehicles in Vehicle Dismantling. Photos can be added to a part that already exists, from its detail or processing view.
      </p>
    </div>
  );
}
