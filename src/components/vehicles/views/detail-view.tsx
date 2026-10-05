"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { User } from "@/lib/types";
import {
  auctionStageInfo,
  canReceiveVehicle,
  cash,
  transportStatusLabels,
  vehicleFieldLabels,
  vehicleTitle,
  type VehicleRecord,
} from "@/lib/mock/vehicles";
import { useAddVehicleNote, useEditVehicle, useVehicleEvents } from "@/lib/query/vehicle-workspace";

/**
 * One vehicle's record. Edits go to the same row through vehicle_edit_fields, and only changed fields are sent.
 * Notes and issue flags are the only actions recorded here. Parts, photos, status and completion come from the
 * flows that own them (dismantling, receiving, processing), so this screen never writes those facts itself.
 */

/** Camel-case record keys the detail form may change, mapped to the snake-case columns the RPC accepts. */
const EDITABLE: [keyof VehicleRecord, string][] = [
  ["year", "year"],
  ["make", "make"],
  ["model", "model"],
  ["trim", "trim"],
  ["engine", "engine"],
  ["mileage", "mileage"],
  ["mileageStatus", "mileage_status"],
  ["titleStatus", "title_status"],
  ["location", "location"],
  ["auctionItemNumber", "auction_item_number"],
  ["purchasePrice", "purchase_price"],
  ["invoiceAmount", "invoice_amount"],
  ["balanceDue", "balance_due"],
  ["auctionFees", "auction_fees"],
  ["transportationCost", "transportation_cost"],
  ["pickupStatus", "pickup_status"],
  ["pickupPin", "pickup_pin"],
  ["pickupDeadline", "pickup_deadline"],
  ["pickupAddress", "pickup_address"],
  ["pickupLocationName", "pickup_location_name"],
  ["damageInfo", "damage_info"],
  ["transportInfo", "transport_info"],
];

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

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "The change was not saved. Nothing was changed.";
}

export function DetailView({ user, vehicle }: { user: User; vehicle: VehicleRecord }) {
  const router = useRouter();
  const eventsQuery = useVehicleEvents(vehicle.id);
  const editMutation = useEditVehicle(vehicle.id);
  const noteMutation = useAddVehicleNote(vehicle.id);
  const events = eventsQuery.data ?? [];
  const canEdit = ["owner", "engineer_admin", "manager", "auction"].includes(user.role);

  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [issue, setIssue] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function startEditing() {
    setEdit(Object.fromEntries(EDITABLE.map(([k]) => [k, String(vehicle[k] ?? "")])));
    setEditing((v) => !v);
    setError("");
  }

  function saveVehicle() {
    const changed: Record<string, string> = {};
    for (const [key, column] of EDITABLE) {
      const next = edit[key] ?? "";
      if (next !== String(vehicle[key] ?? "")) changed[column] = next;
    }
    if (Object.keys(changed).length === 0) {
      setMessage("No changes to save");
      return;
    }
    setError("");
    editMutation.mutate(changed, {
      onSuccess: () => {
        setEditing(false);
        setMessage("Vehicle changes saved to the same record");
      },
      onError: (err) => setError(errorText(err)),
    });
  }

  function submitNote() {
    setError("");
    noteMutation.mutate(
      { action: issue ? "ISSUE_FLAGGED" : "NOTE", note },
      {
        onSuccess: () => {
          setNote("");
          setIssue(false);
          setMessage(issue ? "Issue flagged on this vehicle" : "Note added to this vehicle");
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  }

  const isClosed = Boolean(vehicle.closedReason);
  const partEvents = events.filter((e) => e.action === "PART_REMOVED");
  const completionEvents = events.filter((e) => e.action.startsWith("COMPLETION_"));

  return (
    <div className="space-y-5">
      {message && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{vehicleTitle(vehicle)}</h3>
          <div className="flex items-center gap-2">
            <StatusBadge>{vehicle.status}</StatusBadge>
            {canReceiveVehicle(vehicle, user.role) && (
              <Button size="sm" onClick={() => router.push(`/vehicle-receiving?vehicle=${vehicle.id}`)}>
                Receive Vehicle
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          VIN {vehicle.vin || "—"} · Lot {vehicle.lotNumber || "—"} · Stock {vehicle.stockNumber || "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          {vehicle.auctionSource || "Auction unknown"} · {vehicle.location || "Location not set"} · Assigned{" "}
          {vehicle.assignedName || "Unassigned"}
        </p>
        {isClosed && (
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Closed ({vehicle.closedReason}). Reopen it from the list before changing the record.
          </p>
        )}

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
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Transportation &amp; Arrival</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
            <span className="text-muted-foreground">Pickup location</span>
            <span className="col-span-1 font-medium sm:col-span-3">{vehicle.pickupLocationName || "—"}</span>
            <span className="text-muted-foreground">Transport status</span>
            <span className="font-medium">
              <StatusBadge tone={auctionStageInfo(vehicle).tone}>{transportStatusLabels[vehicle.transportStatus]}</StatusBadge>
            </span>
            <span className="text-muted-foreground">Carrier</span>
            <span className="font-medium">{vehicle.carrierName || (vehicle.carrierId ? "Assigned" : "Not Assigned")}</span>
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
          <p className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Documents &amp; Photos</p>
          <p className="text-xs text-muted-foreground">Arrival photos appear here once the receiving photo upload is connected.</p>
        </div>

        {canEdit && !isClosed && (
          <>
            <Button variant="outline" size="sm" className="mt-4" onClick={startEditing}>
              {editing ? "Close editing" : "Edit vehicle information"}
            </Button>
            {editing && (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {EDITABLE.map(([key]) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`edit-${key}`}>{vehicleFieldLabels[key] ?? key}</Label>
                      <Input
                        id={`edit-${key}`}
                        value={edit[key] ?? ""}
                        onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <Button className="mt-3" onClick={saveVehicle} disabled={editMutation.isPending}>
                  {editMutation.isPending ? "Saving…" : "Save vehicle changes"}
                </Button>
              </>
            )}
          </>
        )}
      </section>

      {!isClosed && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Add a note</h3>
          <div className="max-w-md space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> Flag as an issue
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-note">Note</Label>
              <Textarea
                id="vehicle-note"
                placeholder="What should the team know? (1 to 500 characters)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button onClick={submitNote} disabled={noteMutation.isPending || note.trim().length < 1}>
              {noteMutation.isPending ? "Saving…" : issue ? "Flag issue" : "Save note"}
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Parts removed &amp; custody</h3>
        {partEvents.map((e) => (
          <div key={e.id} className="border-b border-border py-2.5 text-sm last:border-0">
            <b>{e.note || "Part removed"}</b>
            <small className="block text-xs text-muted-foreground">
              {e.actor_name ?? "Unknown"} · {new Date(e.created_at).toLocaleString()}
            </small>
          </div>
        ))}
        {partEvents.length === 0 && <p className="text-sm text-muted-foreground">No parts removed from this vehicle yet.</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Completion &amp; verification</h3>
        {completionEvents.map((e) => (
          <div key={e.id} className="border-b border-border py-2.5 text-sm last:border-0">
            {e.action.replaceAll("_", " ")} · {e.actor_name ?? "Unknown"} · {new Date(e.created_at).toLocaleString()}
            {e.note ? ` · ${e.note}` : ""}
          </div>
        ))}
        {completionEvents.length === 0 && <p className="text-sm text-muted-foreground">No completion activity recorded yet.</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Full record history</h3>
        {eventsQuery.isPending && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {eventsQuery.isError && <p role="alert" className="text-sm text-destructive">The history could not be loaded.</p>}
        <div className="space-y-2">
          {events.map((e) => (
            <p key={e.id} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{e.action.replaceAll("_", " ")}</span> · {e.actor_name ?? "Unknown"} ·{" "}
              {new Date(e.created_at).toLocaleString()}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          ))}
          {eventsQuery.isSuccess && events.length === 0 && <p className="text-sm text-muted-foreground">No recorded actions yet.</p>}
        </div>
      </section>
    </div>
  );
}
