"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { User } from "@/lib/types";
import {
  auctionStageInfo,
  cash,
  transportStatusLabels,
  vehicleFieldLabels,
  vehicleFieldOrder,
  vehicleStatusOptions,
  vehicleTitle,
  type VehicleRecord,
} from "@/lib/mock/vehicles";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import type { VehicleEventAction } from "@/lib/mock/vehicles";

const fullActions: VehicleEventAction[] = ["STATUS", "ASSIGN", "START", "PART_REMOVED", "PHOTO", "COMPLETION_SUBMITTED", "DISPOSITION"];

const infoRows: [string, keyof VehicleRecord | ((v: VehicleRecord) => string)][] = [
  ["VIN", "vin"],
  ["Lot #", "lotNumber"],
  ["Auction item #", "auctionItemNumber"],
  ["Stock #", "stockNumber"],
  ["Trim", "trim"],
  ["Engine", "engine"],
  ["Mileage", (v) => (v.mileage ? `${Number(v.mileage).toLocaleString()} · ${v.mileageStatus}` : "Unverified")],
  ["Title", "titleStatus"],
  ["Auction", "auctionSource"],
  ["Purchase", (v) => (v.unverifiedFields.includes("purchasePrice") ? "Unverified" : cash(v.purchasePrice))],
  ["Pickup PIN", "pickupPin"],
  ["Sale date", "saleDate"],
  ["Pickup status", "pickupStatus"],
  ["Arrival", "arrivalDate"],
  ["Pickup deadline", "pickupDeadline"],
  ["Damage", "damageInfo"],
];

export function DetailView({ user, vehicle }: { user: User; vehicle: VehicleRecord }) {
  const { updateVehicle, recordEvent, vehicleEvents, staff } = useVehicleData();
  const events = vehicleEvents(vehicle.id);

  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>(() =>
    Object.fromEntries(vehicleFieldOrder.map((k) => [k, vehicle[k] as string]))
  );

  const [action, setAction] = useState<VehicleEventAction>("START");
  const [status, setStatus] = useState("Awaiting Transport");
  const [assignee, setAssignee] = useState("");
  const [partType, setPartType] = useState("");
  const [highValue, setHighValue] = useState(false);
  const [disposition, setDisposition] = useState("IN INVENTORY");
  const [dispositionTarget, setDispositionTarget] = useState("");
  const [dispositionLocation, setDispositionLocation] = useState("");
  const [note, setNote] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [sourcePhotoName, setSourcePhotoName] = useState("");
  const [message, setMessage] = useState("");

  const actionOptions = fullActions;
  const highValueRemovals = events.filter((e) => e.action === "PART_REMOVED" && e.highValue);

  function saveVehicle() {
    updateVehicle(vehicle.id, edit as Partial<VehicleRecord>);
    setEditing(false);
    setMessage("Vehicle changes saved to the same record");
  }

  function submitEvent() {
    recordEvent({
      vehicleId: vehicle.id,
      action,
      actorId: user.id,
      note: note || undefined,
      status: action === "STATUS" ? status : undefined,
      assigneeId: action === "ASSIGN" ? assignee : undefined,
      partType: action === "PART_REMOVED" ? partType : undefined,
      highValue: action === "PART_REMOVED" ? highValue : undefined,
      disposition: action === "DISPOSITION" ? disposition : undefined,
      location: action === "DISPOSITION" ? dispositionLocation : undefined,
      hasPhoto: Boolean(photoName) || undefined,
      partId: action === "DISPOSITION" ? dispositionTarget : undefined,
    });
    setMessage(action === "COMPLETION_SUBMITTED" ? "Vehicle submitted for completion review" : "Vehicle action saved");
    setNote("");
    setPhotoName("");
    setSourcePhotoName("");
  }

  return (
    <div className="space-y-5">
      {message && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {message}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{vehicleTitle(vehicle)}</h3>
          <StatusBadge>{vehicle.status}</StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          VIN {vehicle.vin || "—"} · Lot {vehicle.lotNumber || "—"} · Stock {vehicle.stockNumber || "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          {vehicle.auctionSource || "Auction unknown"} · {vehicle.location || "Location not set"} · Assigned{" "}
          {vehicle.assignedName || "Unassigned"}
        </p>

        <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {infoRows.map(([label, accessor]) => (
                <div key={label}>
                  <small className="block text-xs text-muted-foreground">{label}</small>
                  <b className="text-sm">
                    {typeof accessor === "function" ? accessor(vehicle) : (vehicle[accessor] as string) || "—"}
                  </b>
                </div>
              ))}
            </div>
            {vehicle.unverifiedFields.length > 0 && (
              <p className="mt-3 text-xs text-warning-foreground">
                Unverified: {vehicle.unverifiedFields.map((k) => vehicleFieldLabels[k] || k).join(", ")}
              </p>
            )}
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Transportation &amp; Arrival
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
                <span className="text-muted-foreground">Pickup location</span>
                <span className="col-span-1 font-medium sm:col-span-3">{vehicle.pickupLocationName || "—"}</span>
                <span className="text-muted-foreground">Transport status</span>
                <span className="font-medium">
                  <StatusBadge tone={auctionStageInfo(vehicle).tone}>{transportStatusLabels[vehicle.transportStatus]}</StatusBadge>
                </span>
                <span className="text-muted-foreground">Carrier</span>
                <span className="font-medium">{vehicle.carrierName || "Not Assigned"}</span>
                <span className="text-muted-foreground">Transport price</span>
                <span className="font-medium">{vehicle.transportPrice ? cash(vehicle.transportPrice) : "—"}</span>
                <span className="text-muted-foreground">Received by</span>
                <span className="font-medium">{vehicle.receivedBy || "—"}</span>
                {vehicle.transportProblem && (
                  <>
                    <span className="text-destructive">Problem</span>
                    <span className="col-span-1 font-medium text-destructive sm:col-span-3">{vehicle.transportProblem}</span>
                  </>
                )}
              </div>
              <p className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Documents &amp; Photos
              </p>
              {vehicle.arrivalPhotos.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {vehicle.arrivalPhotos.map((p) => (
                    <div key={p.id} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-border bg-background text-muted-foreground">
                      <Camera className="size-4" />
                      <span className="text-[9px]">{p.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No arrival photos linked yet.</p>
              )}
            </div>

            <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(!editing)}>
              {editing ? "Close editing" : "Edit vehicle information"}
            </Button>
            {editing && (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {vehicleFieldOrder.map((key) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{vehicleFieldLabels[key]}</Label>
                      <Input value={edit[key] ?? ""} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <Button className="mt-3" onClick={saveVehicle}>
                  Save vehicle changes
                </Button>
              </>
            )}
          </>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Record an action</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {actionOptions.map((a) => (
            <Button key={a} size="sm" variant={action === a ? "default" : "outline"} onClick={() => setAction(a)}>
              {a.replaceAll("_", " ")}
            </Button>
          ))}
        </div>

        <div className="max-w-md space-y-3">
          {action === "STATUS" && (
            <div className="space-y-1.5">
              <Label>Vehicle status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vehicleStatusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "ASSIGN" && (
            <div className="space-y-1.5">
              <Label>Assign employee</Label>
              <Select value={assignee} onValueChange={(v) => setAssignee(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === "PART_REMOVED" && (
            <>
              <div className="space-y-1.5">
                <Label>Part type</Label>
                <Input
                  placeholder="e.g. catalytic converter"
                  value={partType}
                  onChange={(e) => setPartType(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={highValue} onCheckedChange={(v) => setHighValue(Boolean(v))} /> High-value part
              </label>
            </>
          )}

          {action === "DISPOSITION" && (
            <>
              <div className="space-y-1.5">
                <Label>Select high-value part</Label>
                <Select value={dispositionTarget} onValueChange={(v) => setDispositionTarget(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select removal" />
                  </SelectTrigger>
                  <SelectContent>
                    {highValueRemovals.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.partType} · {e.disposition || "UNRECONCILED"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Disposition</Label>
                <Select value={disposition} onValueChange={(v) => setDisposition(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["IN INVENTORY", "SOLD", "SHIPPED", "OTHER DISPOSITION"].map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Disposition location</Label>
                <Input
                  placeholder="Inventory location / reference"
                  value={dispositionLocation}
                  onChange={(e) => setDispositionLocation(e.target.value)}
                />
              </div>
            </>
          )}

          {["PART_REMOVED", "PHOTO", "COMPLETION_SUBMITTED"].includes(action) && (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
              <Camera className="size-4" /> Take photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")} />
              {photoName && <span className="text-muted-foreground">{photoName}</span>}
            </label>
          )}
          {action === "PART_REMOVED" && (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
              <Camera className="size-4" /> Take VIN or Lot evidence photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setSourcePhotoName(e.target.files?.[0]?.name || "")}
              />
              {sourcePhotoName && <span className="text-muted-foreground">{sourcePhotoName}</span>}
            </label>
          )}

          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea placeholder="Optional short note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <Button onClick={submitEvent}>
            {action === "COMPLETION_SUBMITTED" ? "Submit vehicle finished for review" : "Save action"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Parts removed & custody</h3>
        {events
          .filter((e) => e.action === "PART_REMOVED")
          .map((e) => (
            <div key={e.id} className="flex items-start gap-3 border-b border-border py-3 last:border-0">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                {e.hasPhoto && <Camera className="size-4 text-muted-foreground" />}
              </div>
              <span className="min-w-0">
                <b className="block text-sm">{e.partType}</b>
                <small className="text-xs text-muted-foreground">
                  {e.actorName} · {new Date(e.createdAt).toLocaleString()}
                </small>
                {e.partId && <small className="block text-xs text-muted-foreground">Pending part record {e.partId}</small>}
                {e.highValue && (
                  <strong className="mt-0.5 block text-xs font-semibold text-warning-foreground">
                    {e.disposition || "UNRECONCILED · needs manager review"}
                  </strong>
                )}
              </span>
            </div>
          ))}
        {!events.some((e) => e.action === "PART_REMOVED") && (
          <p className="text-sm text-muted-foreground">No parts removed from this vehicle yet.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Completion submissions & verification</h3>
        {events
          .filter((e) => ["COMPLETION_SUBMITTED", "COMPLETION_NEEDS_CORRECTION", "COMPLETION_APPROVED", "COMPLETION_CREDIT"].includes(e.action))
          .map((e) => (
            <div key={e.id} className="border-b border-border py-2.5 text-sm last:border-0">
              {e.action.replaceAll("_", " ")} · {e.actorName} · {new Date(e.createdAt).toLocaleString()}
              {e.note ? ` · ${e.note}` : ""}
            </div>
          ))}
        {!events.some((e) => e.action.startsWith("COMPLETION")) && (
          <p className="text-sm text-muted-foreground">No completion activity recorded yet.</p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Full record history</h3>
        <div className="space-y-2">
          {events.map((e) => (
            <p key={e.id} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{e.action.replaceAll("_", " ")}</span> · {e.actorName} ·{" "}
              {new Date(e.createdAt).toLocaleString()}
            </p>
          ))}
          {!events.length && <p className="text-sm text-muted-foreground">No recorded actions yet.</p>}
        </div>
      </section>
    </div>
  );
}
