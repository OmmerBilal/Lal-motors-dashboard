"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";

export function ArrivalView({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const { vehicles, recordArrival } = useDispatchData();
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const [yardLocation, setYardLocation] = useState("");
  const [keysReceived, setKeysReceived] = useState(false);
  const [titleStatus, setTitleStatus] = useState("");
  const [damage, setDamage] = useState("");
  const [note, setNote] = useState("");
  const [photoName, setPhotoName] = useState("");

  if (!vehicle) return null;

  function confirm() {
    recordArrival(vehicleId, yardLocation);
    onDone();
  }

  return (
    <section className="max-w-xl space-y-4">
      <h3 className="text-base font-semibold">Vehicle Arrival</h3>
      <p className="text-sm text-muted-foreground">
        Existing record: Lot {vehicle.lotNumber || "—"} · VIN {vehicle.vin || "—"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Arrival date/time</Label>
          <Input value={new Date().toLocaleString()} readOnly />
        </div>
        <div className="space-y-1.5">
          <Label>Yard location</Label>
          <Input value={yardLocation} onChange={(e) => setYardLocation(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={keysReceived} onCheckedChange={(v) => setKeysReceived(Boolean(v))} /> Keys received
        </label>
        <div className="space-y-1.5">
          <Label>Title / documents</Label>
          <Input value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Damage / issues</Label>
          <Input value={damage} onChange={(e) => setDamage(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
        Arrival photos
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")} />
      </label>
      {photoName && <p className="text-xs text-muted-foreground">{photoName}</p>}
      <Button disabled={!yardLocation} onClick={confirm}>
        Confirm Arrival
      </Button>
    </section>
  );
}
