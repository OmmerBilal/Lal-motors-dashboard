"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { vehicleFieldLabels, vehicleFieldOrder, vehicleTitle, type IntakeItem } from "@/lib/mock/vehicles";
import { buildIntakeItems } from "@/lib/mock/parse-intake";
import { evaluateIntakeBatch, type IntakeMatchStatus } from "@/lib/data/vehicles";
import { ExistingVehicleMerge } from "@/components/vehicles/views/existing-vehicle-merge";
import { useIntakeVehicles } from "@/lib/query/vehicles";
import { toast } from "sonner";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

export function ReviewView({
  batch,
  onDone,
  onOpenVehicle,
}: {
  batch: { method: IntakeMethod; sourceText: string };
  onDone: () => void;
  onOpenVehicle: (id: string) => void;
}) {
  const commit = useIntakeVehicles();
  // Parsing is deterministic and local. Duplicate status is decided by the database, not by a list in memory.
  const [items, setItems] = useState<IntakeItem[]>(() => buildIntakeItems(batch.method, batch.sourceText, []));
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      // One server check for the whole batch: duplicates inside the batch and existing vehicles are both decided on the
      // server, against the same rules the commit uses. Rows that fail local validation are not sent.
      const candidates = items.filter((i) => !i.errors.length);
      let results;
      try {
        results = await evaluateIntakeBatch(candidates.map((i) => ({ ...i.draft, sourceText: i.sourceExcerpt ?? "" })));
      } catch {
        if (!alive) return;
        setItems(items.map((i) => (i.errors.length ? i : { ...i, errors: [...i.errors, "Could not check this batch for duplicates. Try again."] })));
        setChecking(false);
        return;
      }
      if (!alive) return;
      const byId = new Map<string, { status: IntakeMatchStatus; vehicle_id?: string | null; reason?: string | null }>();
      results.forEach((r) => byId.set(candidates[r.index].id, r));
      const checked: IntakeItem[] = items.map((item): IntakeItem => {
        const r = byId.get(item.id);
        if (!r) return item;
        if (r.status === "invalid") return { ...item, match: { status: "invalid" }, errors: [...item.errors, r.reason ?? "This row is incomplete."] };
        return {
          ...item,
          match: r.status === "new" ? { status: "new" } : { status: r.status, vehicle: r.vehicle_id ? { id: r.vehicle_id } : undefined },
        };
      });
      setItems(checked);
      setSelected(checked.filter((i) => !i.errors.length && i.match.status === "new").map((i) => i.id));
      setChecking(false);
    })();
    return () => {
      alive = false;
    };
    // Runs once per batch: the review list is then edited locally until confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = items.filter((x) => !x.errors.length && x.match.status === "new").length;
  const needsReview = items.filter((x) => x.errors.length).length;
  const duplicates = items.filter((x) => ["existing", "conflict", "duplicate"].includes(x.match.status)).length;

  function removeItem(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    setSelected((xs) => xs.filter((x) => x !== id));
  }

  function saveEdit(id: string, draft: IntakeItem["draft"]) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, draft: { ...draft, uncertainFields: [] }, errors: [] } : x)));
  }

  /** Only vehicles the database reported as new are ever sent. Existing and conflicting records are resolved in their own record. */
  function confirm(ids: string[]) {
    const chosen = items.filter((i) => ids.includes(i.id) && i.match.status === "new" && !i.errors.length);
    if (chosen.length === 0) return;
    commit.mutate(
      chosen.map((i) => ({ ...i.draft, sourceText: i.sourceExcerpt ?? "" })),
      {
        onSuccess: (r) => {
          toast.success(`${r.created} created · ${r.existing} already in inventory · ${r.duplicates} duplicate · ${r.conflicts} conflict`);
          if (r.messages.length) toast.error(r.messages.slice(0, 3).join(" | "));
          // Compute the remaining rows from the current list, then update state and call the parent from this event
          // handler. Calling the parent inside a state updater runs it during render and triggers React's warning.
          const remaining = items.filter((x) => !ids.includes(x.id));
          setItems(remaining);
          setSelected((xs) => xs.filter((x) => !ids.includes(x)));
          if (remaining.length === 0) onDone();
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save these vehicles. Nothing was changed."),
      }
    );
  }

  return (
    <div className="space-y-4">
      {checking && <p className="text-sm text-muted-foreground">Checking this batch for duplicates and existing vehicles…</p>}
      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4 text-sm">
        <b>{items.length} vehicles detected</b>
        <span className="text-success">✓ {ready} ready</span>
        <span className="text-warning-foreground">⚠ {needsReview} need review</span>
        <span className="text-destructive">⛔ {duplicates} duplicates or conflicts</span>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 p-3">
              <Checkbox
                aria-label={`Select ${vehicleTitle(item.draft)}`}
                checked={selected.includes(item.id)}
                disabled={item.match.status !== "new" || item.errors.length > 0}
                onCheckedChange={(v) =>
                  setSelected((xs) => (v ? [...xs, item.id] : xs.filter((x) => x !== item.id)))
                }
              />
              <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === item.id ? "" : item.id)}>
                <b className="block truncate text-sm">{vehicleTitle(item.draft)}</b>
                <small className="text-xs text-muted-foreground">
                  VIN {item.draft.vin || "—"} · Lot {item.draft.lotNumber || "—"} ·{" "}
                  {item.errors.length
                    ? "NEEDS REVIEW"
                    : item.match.status === "existing"
                      ? "EXISTING VEHICLE"
                      : item.match.status === "conflict"
                        ? "CONFLICT"
                        : item.match.status === "duplicate"
                          ? "DUPLICATE IN BATCH"
                          : "READY"}
                </small>
              </button>
              <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                Remove
              </Button>
            </div>
            {expanded === item.id && (
              <ReviewEditor
                item={item}
                onSave={(d) => saveEdit(item.id, d)}
                onConfirm={() => confirm([item.id])}
                onOpenExisting={(id) => onOpenVehicle(id)}
                onMerged={() => {
                  toast.success("Updated the existing vehicle with the chosen fields");
                  removeItem(item.id);
                }}
              />
            )}
          </div>
        ))}
      </div>

      <Button disabled={!selected.length} onClick={() => confirm(selected)}>
        Confirm & Add Verified Vehicles ({selected.length})
      </Button>
    </div>
  );
}

function ReviewEditor({
  item,
  onSave,
  onConfirm,
  onOpenExisting,
  onMerged,
}: {
  item: IntakeItem;
  onSave: (d: IntakeItem["draft"]) => void;
  onConfirm: () => void;
  onOpenExisting: (id: string) => void;
  onMerged: () => void;
}) {
  const [draft, setDraft] = useState(item.draft);
  const uncertain = useMemo(() => new Set(item.draft.uncertainFields || []), [item.draft.uncertainFields]);

  return (
    <div className="border-t border-border bg-muted/20 p-4">
      <div className="mb-4 rounded-md border border-dashed border-border bg-background p-3">
        <b className="block text-xs font-semibold uppercase text-muted-foreground">Original source for this vehicle</b>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {item.sourceExcerpt || "Original pasted text or manual entry saved with this batch."}
        </pre>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vehicleFieldOrder.map((key) => (
          <div key={key} className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              {vehicleFieldLabels[key]}
              {uncertain.has(key) && <em className="text-[10px] font-semibold text-warning-foreground not-italic">NEEDS REVIEW</em>}
            </Label>
            <Input value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      {item.errors.length > 0 && <p className="mt-3 text-sm font-medium text-destructive">{item.errors.join(" · ")}</p>}
      {item.reviewNotes && item.reviewNotes.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-warning/40 bg-warning/5 p-2.5 text-xs text-warning-foreground">
          <b className="block font-semibold">Found in the text, not stored (no matching field yet):</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {item.reviewNotes.map((n, idx) => (
              <li key={idx}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {["existing", "conflict"].includes(item.match.status) && item.match.vehicle?.id && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {item.match.status === "conflict"
              ? "The identifiers point at this existing record. A new record is not created. Compare and choose below, or open it."
              : "This vehicle is already in inventory, so it is not added again. Compare and choose below, or open it."}
          </p>
          <ExistingVehicleMerge vehicleId={item.match.vehicle.id} draft={draft} onMerged={onMerged} />
          <Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => onOpenExisting(item.match.vehicle!.id)}>
            Open existing record
          </Button>
        </>
      )}
      {item.match.status === "duplicate" && (
        <p className="mt-3 text-xs text-muted-foreground">
          The same vehicle appears earlier in this batch with identical details. It is not added twice. Remove this row, or keep the earlier one.
        </p>
      )}
      {item.match.status === "conflict" && !item.match.vehicle?.id && (
        <p className="mt-3 text-xs text-warning-foreground">
          This identifier appears in this batch with different details. Neither row is added until you resolve it: remove the wrong row, or correct it and check the batch again.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onSave(draft)}>
          Save corrections &amp; mark reviewed
        </Button>
        <Button disabled={item.errors.length > 0 || item.match.status !== "new"} onClick={onConfirm}>
          Confirm this vehicle
        </Button>
      </div>
    </div>
  );
}
