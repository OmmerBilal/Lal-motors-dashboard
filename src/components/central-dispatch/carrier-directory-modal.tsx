"use client";

import { useState } from "react";
import { Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";

const fields: [string, string][] = [
  ["company", "Company name"],
  ["driver", "Driver name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address", "Address"],
  ["mcDot", "MC / DOT"],
  ["notes", "Notes"],
];

export function CarrierDirectoryModal({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (carrierId: string) => void;
}) {
  const { carriers, addCarrier } = useVehicleData();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  function save() {
    const id = addCarrier({
      company: draft.company || "",
      driver: draft.driver || "",
      phone: draft.phone || "",
      email: draft.email || "",
      address: draft.address || "",
      mcDot: draft.mcDot || "",
      notes: draft.notes || "",
    });
    setDraft({});
    setAdding(false);
    onSaved?.(id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Carrier Directory</DialogTitle>
        </DialogHeader>

        {!adding ? (
          <>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {carriers.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Truck className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{c.company}</b>
                    <small className="block truncate text-xs text-muted-foreground">
                      {c.driver} · {c.phone || "No phone"} {c.mcDot ? `· ${c.mcDot}` : ""}
                    </small>
                  </span>
                </div>
              ))}
              {!carriers.length && <p className="text-sm text-muted-foreground">No carriers saved yet.</p>}
            </div>
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add Carrier
            </Button>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input value={draft[key] || ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button disabled={!draft.company} onClick={save}>
                Save Carrier
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
