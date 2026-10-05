"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useApplyVehicleMerge, useVehicleRecord } from "@/lib/query/vehicle-workspace";

/**
 * Field-by-field comparison for an intake row that matches an existing vehicle.
 * Default: KEEP CURRENT. A blank current value defaults to USE INCOMING. A differing value is never replaced without
 * an explicit choice. Lot and stock numbers can only be filled when blank. VIN, status, lifecycle, transport, history,
 * and financial fields are not offered here: product decision, documented in the master spec.
 */
type MergeField = { key: string; column: string; label: string; identifier?: boolean; normalize?: (v: string) => string };

export const MERGE_FIELDS: MergeField[] = [
  { key: "year", column: "year", label: "Year" },
  { key: "make", column: "make", label: "Make" },
  { key: "model", column: "model", label: "Model" },
  { key: "trim", column: "trim", label: "Trim" },
  { key: "engine", column: "engine", label: "Engine" },
  { key: "mileage", column: "mileage", label: "Mileage", normalize: (v) => v.replace(/[,\s]/g, "") },
  { key: "location", column: "location", label: "Location" },
  { key: "auctionItemNumber", column: "auction_item_number", label: "Auction item #" },
  { key: "pickupLocationName", column: "pickup_location_name", label: "Pickup location" },
  { key: "pickupAddress", column: "pickup_address", label: "Pickup address" },
  { key: "pickupPin", column: "pickup_pin", label: "Pickup PIN" },
  { key: "pickupStatus", column: "pickup_status", label: "Pickup status" },
  { key: "damageInfo", column: "damage_info", label: "Damage" },
  { key: "transportInfo", column: "transport_info", label: "Transport info" },
  { key: "lotNumber", column: "lot_number", label: "Lot #", identifier: true },
  { key: "stockNumber", column: "stock_number", label: "Stock #", identifier: true },
];

type Row = { field: MergeField; current: string; incoming: string; locked: boolean; defaultChoice: "keep" | "incoming" };

/** Only fields where the incoming record has a value and it differs. Same values are not shown. */
export function mergeRows(current: Record<string, unknown>, draft: Record<string, unknown>): Row[] {
  const rows: Row[] = [];
  for (const field of MERGE_FIELDS) {
    const incoming = (field.normalize ? field.normalize(String(draft[field.key] ?? "")) : String(draft[field.key] ?? "").trim());
    if (!incoming) continue;
    const cur = String(current[field.key] ?? "").trim();
    if (cur === incoming) continue;
    if (field.identifier && cur !== "") {
      rows.push({ field, current: cur, incoming, locked: true, defaultChoice: "keep" });
      continue;
    }
    rows.push({ field, current: cur, incoming, locked: false, defaultChoice: cur === "" ? "incoming" : "keep" });
  }
  return rows;
}

export function ExistingVehicleMerge({
  vehicleId,
  draft,
  onMerged,
}: {
  vehicleId: string;
  draft: Record<string, unknown>;
  onMerged: () => void;
}) {
  const recordQuery = useVehicleRecord(vehicleId);
  const merge = useApplyVehicleMerge(vehicleId);
  const [choices, setChoices] = useState<Record<string, "keep" | "incoming">>({});
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  if (recordQuery.isPending) return <p className="text-sm text-muted-foreground" aria-live="polite">Loading the existing vehicle…</p>;
  if (recordQuery.isError || !recordQuery.data) {
    return <p role="alert" className="text-sm text-destructive">The existing vehicle could not be loaded. Try again.</p>;
  }

  const { record, updatedAt } = recordQuery.data;
  const rows = mergeRows(record as unknown as Record<string, unknown>, draft);
  const choiceFor = (row: Row) => (row.locked ? "keep" : choices[row.field.key] ?? row.defaultChoice);
  const changes = rows
    .filter((row) => !row.locked && choiceFor(row) === "incoming")
    .map((row) => ({ column: row.field.column, value: row.incoming, label: row.field.label, from: row.current }));

  function confirm() {
    setError(null);
    setStale(false);
    const payload = Object.fromEntries(changes.map((c) => [c.column, c.value]));
    merge.mutate(
      { expectedUpdatedAt: updatedAt, changes: payload },
      {
        onSuccess: () => onMerged(),
        onError: (err) => {
          const message = err instanceof Error ? err.message : "The update was not saved. Nothing was changed.";
          if (message.startsWith("STALE")) setStale(true);
          setError(message.replace(/^STALE:\s*/, ""));
        },
      },
    );
  }

  return (
    <section className="mt-3 space-y-3 rounded-md border border-border bg-background p-3" aria-label="Existing vehicle comparison">
      <div>
        <p className="text-sm font-semibold">EXISTING VEHICLE FOUND</p>
        <p className="text-xs text-muted-foreground">
          {record.year} {record.make} {record.model} · VIN {record.vin || "—"}. Nothing changes unless you choose it below.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">The new record has no differences to review. Keep the current record as it is.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const choice = choiceFor(row);
            return (
              <li key={row.field.key} className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">{row.field.label}</p>
                <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <span className="block text-xs text-muted-foreground">Current</span>
                    <span className="break-words">{row.current || "Blank"}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">Incoming</span>
                    <span className="break-words">{row.incoming}</span>
                  </div>
                </div>
                {row.locked ? (
                  <p className="text-xs text-muted-foreground">Keeps current. This identifier is already set and cannot be replaced by an intake.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={choice === "keep" ? "default" : "outline"}
                      className="min-h-11"
                      aria-pressed={choice === "keep"}
                      onClick={() => setChoices({ ...choices, [row.field.key]: "keep" })}
                    >
                      Keep current
                    </Button>
                    <Button
                      type="button"
                      variant={choice === "incoming" ? "default" : "outline"}
                      className="min-h-11"
                      aria-pressed={choice === "incoming"}
                      onClick={() => setChoices({ ...choices, [row.field.key]: "incoming" })}
                    >
                      Use incoming
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-md bg-muted/40 p-3 text-sm" aria-live="polite">
        <p className="font-medium">Preview of this update</p>
        {changes.length === 0 ? (
          <p className="text-muted-foreground">No changes selected. The current record stays as it is.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {changes.map((c) => (
              <li key={c.column} className="text-xs">
                {c.label}: {c.from || "Blank"} → <b>{c.value}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div role="alert" className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          {stale && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => recordQuery.refetch()}>
              Refresh comparison
            </Button>
          )}
        </div>
      )}

      <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={changes.length === 0 || merge.isPending} onClick={confirm}>
        {merge.isPending ? "Updating…" : "Confirm update"}
      </Button>
    </section>
  );
}
