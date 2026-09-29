"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { dispatchIntakeFields } from "@/lib/mock/central-dispatch";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";

export type IntakeMode = "bulk" | "scan" | "manual";

type Draft = Record<string, string>;

type ReviewItem = {
  id: string;
  draft: Draft;
  existingId: string | null;
};

function parseLine(line: string): Draft {
  const vin = line.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() || "";
  const lot = line.match(/\b\d{7,9}\b/)?.[0] || "";
  const year = line.match(/\b(19|20)\d{2}\b/)?.[0] || "";
  const makes = ["Ford", "Chevrolet", "Toyota", "Honda", "Nissan", "Jeep", "BMW", "Tesla", "Hyundai", "Kia"];
  const make = makes.find((m) => new RegExp(`\\b${m}\\b`, "i").test(line)) || "";
  const model = make ? line.slice(line.toLowerCase().indexOf(make.toLowerCase()) + make.length).trim().split(/[\s,]+/)[0] || "" : "";
  return {
    auctionSource: "Copart",
    lotNumber: lot,
    vin,
    year,
    make,
    model,
    location: "",
    pickupAddress: "",
    pickupPin: "",
    purchasePrice: "",
  };
}

const scanCanned: Draft = {
  auctionSource: "IAA",
  lotNumber: "77340210",
  vin: "JTDKN3DU0E1234567",
  year: "2019",
  make: "Toyota",
  model: "Prius",
  location: "IAA Tampa",
  pickupAddress: "1500 Cargo Way, Tampa, FL",
  pickupPin: "",
  purchasePrice: "3800",
};

export function IntakeReviewView({ mode, onDone }: { mode: IntakeMode; onDone: () => void }) {
  const { vehicles, addVehicle } = useDispatchData();
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [manual, setManual] = useState<Draft>({ auctionSource: "Copart" });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ReviewItem[] | null>(null);

  function process() {
    setBusy(true);
    window.setTimeout(() => {
      let drafts: Draft[];
      if (mode === "manual") drafts = [manual];
      else if (mode === "scan") drafts = [scanCanned];
      else drafts = source.split(/\n+/).map((l) => l.trim()).filter(Boolean).map(parseLine);
      if (!drafts.length) drafts = [parseLine(source)];

      setItems(
        drafts.map((draft, i) => {
          const existing = vehicles.find((v) => (draft.vin && v.vin === draft.vin) || (draft.lotNumber && v.lotNumber === draft.lotNumber));
          return { id: `dintake-${Date.now()}-${i}`, draft, existingId: existing?.id ?? null };
        })
      );
      setBusy(false);
    }, 350);
  }

  function updateDraft(id: string, key: string, value: string) {
    setItems((xs) => xs?.map((x) => (x.id === id ? { ...x, draft: { ...x.draft, [key]: value } } : x)) ?? xs);
  }

  function confirmAll() {
    items
      ?.filter((i) => !i.existingId)
      .forEach((i) => {
        addVehicle({
          lotNumber: i.draft.lotNumber || "",
          vin: i.draft.vin || "",
          year: i.draft.year || "",
          make: i.draft.make || "",
          model: i.draft.model || "",
          location: i.draft.location || "",
          pickupPin: i.draft.pickupPin || "",
          pickupAddress: i.draft.pickupAddress || "",
          status: "Purchased",
        });
      });
    onDone();
  }

  if (items) {
    return (
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Review Vehicles — {items.length}</h3>
        <p className="text-sm text-muted-foreground">
          Correct every vehicle before saving. A matching VIN or lot stays linked to its existing record.
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Review</th>
                {dispatchIntakeFields.map(([key, label]) => (
                  <th key={key} className="p-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="p-2 align-top">
                    {item.existingId ? (
                      <b className="text-xs">
                        ALREADY EXISTS
                        <br />
                        Open in vehicles below
                      </b>
                    ) : (
                      <span className="text-xs font-medium text-success">Ready</span>
                    )}
                  </td>
                  {dispatchIntakeFields.map(([key]) => (
                    <td key={key} className="p-2">
                      <Input
                        aria-label={`${key} for ${item.id}`}
                        value={item.draft[key] ?? ""}
                        onChange={(e) => updateDraft(item.id, key, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button onClick={confirmAll}>Confirm new vehicles in Inventory</Button>
          <Button variant="outline" onClick={onDone}>
            View existing vehicles
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-4">
      <h3 className="text-base font-semibold">
        {mode === "bulk" ? "Paste Multiple Vehicles" : mode === "scan" ? "Photo / Screenshot" : "Manual Vehicle Entry"}
      </h3>
      {mode === "manual" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {dispatchIntakeFields.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <label className="text-sm font-medium">{label}</label>
              <Input value={manual[key] ?? ""} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {mode === "bulk" && (
            <Textarea
              aria-label="Paste auction vehicles"
              placeholder="Paste copied auction vehicle rows here"
              rows={9}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          )}
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm font-medium text-primary">
            <Camera className="size-4" /> {mode === "scan" ? "Take photo or upload screenshot" : "Optional screenshot"}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name || "")} />
          </label>
          {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
        </>
      )}
      <Button disabled={busy} onClick={process}>
        {busy ? "Processing…" : mode === "manual" ? "Review Vehicle" : "Process with AI"}
      </Button>
    </section>
  );
}
