"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emptyVehicleDraft,
  vehicleFieldLabels,
  vehicleFieldOrder,
} from "@/lib/mock/vehicles";
import type { IntakeMethod } from "@/components/vehicles/vehicle-workspace";

const methods: { id: IntakeMethod; label: string }[] = [
  { id: "bulk", label: "Bulk Paste" },
  { id: "single", label: "Single Paste" },
  { id: "scan", label: "AI Scan" },
  { id: "manual", label: "Manual Entry" },
];

export function IntakeView({
  method,
  onChangeMethod,
  onAnalyzed,
}: {
  method: IntakeMethod;
  onChangeMethod: (m: IntakeMethod) => void;
  onAnalyzed: (sourceText: string) => void;
}) {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({ ...emptyVehicleDraft });
  const [busy, setBusy] = useState(false);

  function analyze() {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      onAnalyzed(method === "manual" ? JSON.stringify(manual) : source);
    }, 400);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => (
          <Button
            key={m.id}
            type="button"
            size="sm"
            variant={method === m.id ? "default" : "outline"}
            onClick={() => {
              onChangeMethod(m.id);
              setSource("");
              setFileName("");
            }}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {method === "manual" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicleFieldOrder.map((key) => (
            <div key={key} className="space-y-1.5">
              <Label>{vehicleFieldLabels[key]}</Label>
              <Input value={manual[key] ?? ""} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>Paste Auction Data</Label>
            <Textarea
              rows={method === "bulk" ? 12 : 7}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={
                method === "bulk"
                  ? "Paste the entire list of purchased vehicles here. Do not separate them manually."
                  : "Paste auction information here, or add an image below."
              }
            />
          </div>
          {method === "scan" && (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
              <Camera className="size-4" /> Take or upload auction image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
              />
              {fileName && <span className="text-muted-foreground">{fileName}</span>}
            </label>
          )}
        </>
      )}

      <div>
        <Button disabled={busy} onClick={analyze}>
          {busy ? "Analyzing…" : method === "manual" ? "Review vehicle" : "Analyze vehicles"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing enters permanent inventory until you confirm the reviewed vehicle.
        </p>
      </div>
    </div>
  );
}
