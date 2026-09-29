"use client";

import { useState } from "react";
import { Camera, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";

const fields: [string, string][] = [
  ["company", "Company name"],
  ["driver", "Driver name"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["address", "Address"],
  ["mcDot", "MC / DOT"],
  ["notes", "Notes"],
];

export function CarrierView({ onSaved }: { onSaved: (carrierId: string) => void }) {
  const { addCarrier } = useDispatchData();
  const [carrier, setCarrier] = useState<Record<string, string>>({});
  const [docName, setDocName] = useState("");
  const [busy, setBusy] = useState(false);

  function extractWithAi() {
    setBusy(true);
    window.setTimeout(() => {
      setCarrier((c) => ({
        ...c,
        company: c.company || "Gulf Coast Auto Carriers",
        driver: c.driver || "Sam Whitfield",
        phone: c.phone || "(813) 555-0110",
        mcDot: c.mcDot || "MC-901244",
      }));
      setBusy(false);
    }, 500);
  }

  function save() {
    const id = `car-${Date.now()}`;
    addCarrier({
      company: carrier.company || "",
      driver: carrier.driver || "",
      phone: carrier.phone || "",
      email: carrier.email || "",
      address: carrier.address || "",
      mcDot: carrier.mcDot || "",
      notes: carrier.notes || "",
    });
    onSaved(id);
  }

  return (
    <section className="max-w-xl space-y-4">
      <h3 className="text-base font-semibold">Add Carrier</h3>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
        <Camera className="size-4" /> Carrier document / company photo
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setDocName(e.target.files?.[0]?.name || "")} />
      </label>
      {docName && (
        <Button variant="outline" size="sm" disabled={busy} onClick={extractWithAi}>
          <Sparkles /> Extract carrier details with AI
        </Button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label>{label}</Label>
            <Input value={carrier[key] || ""} onChange={(e) => setCarrier({ ...carrier, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      <Button disabled={!carrier.company} onClick={save}>
        Save Carrier &amp; Use for Dispatch
      </Button>
    </section>
  );
}
