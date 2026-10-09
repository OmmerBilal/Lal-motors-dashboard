"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetPickupLocation } from "@/lib/query/dispatch";
import type { VehicleRecord } from "@/lib/mock/vehicles";

/**
 * Sets or changes ONE vehicle's pickup location (name + address). Saves to the same vehicle record
 * (pickup_location_name / pickup_address) through the existing vehicle_edit_fields RPC — the same fields
 * already editable on the vehicle detail screen, just reachable directly from Central Dispatch. The vehicle's
 * `location` (its auction branch, a different field) is shown only as a non-binding hint.
 */
export function PickupLocationDialog({
  vehicle,
  onOpenChange,
}: {
  vehicle: VehicleRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const setLocation = useSetPickupLocation();
  // Initial state only: the parent remounts this component (key={vehicle.id}) whenever the vehicle changes, so
  // the draft always starts fresh from that vehicle's current saved values — no effect needed to reset it.
  const [name, setName] = useState(vehicle?.pickupLocationName ?? "");
  const [address, setAddress] = useState(vehicle?.pickupAddress ?? "");

  function save() {
    if (!vehicle || !name.trim()) return;
    setLocation.mutate(
      { vehicleId: vehicle.id, pickupLocationName: name.trim(), pickupAddress: address.trim() },
      {
        onSuccess: () => {
          toast.success("Pickup location saved.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "The pickup location was not saved. Nothing was changed."),
      },
    );
  }

  return (
    <Dialog open={!!vehicle} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pickup location</DialogTitle>
        </DialogHeader>
        {vehicle && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
              {vehicle.vin ? ` · VIN ${vehicle.vin}` : ""}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pickup-location-name">Pickup location name *</Label>
              <Input
                id="pickup-location-name"
                className="h-11"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={vehicle.location ? `e.g. ${vehicle.location}` : "e.g. Atlanta East"}
                maxLength={120}
              />
              {vehicle.location && !vehicle.pickupLocationName && (
                <p className="text-xs text-muted-foreground">This vehicle&apos;s auction location is &ldquo;{vehicle.location}&rdquo; — shown as a hint only; enter the pickup location to save it.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pickup-location-address">Pickup address (optional)</Label>
              <Input id="pickup-location-address" className="h-11" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
            </div>
          </div>
        )}
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-11 w-full" disabled={!name.trim() || setLocation.isPending} onClick={save}>
            {setLocation.isPending ? "Saving…" : "Save pickup location"}
          </Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
