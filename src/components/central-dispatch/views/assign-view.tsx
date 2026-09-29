"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";

const reasons = ["Carrier cancelled", "Failed pickup", "Changed carrier", "Other — see note"];

export function AssignView({
  redispatch,
  selected,
  onAddCarrier,
  onDone,
}: {
  redispatch: boolean;
  selected: string[];
  onAddCarrier: () => void;
  onDone: (jobId: string) => void;
}) {
  const { vehicles, carriers, createDispatch } = useDispatchData();
  const [carrierId, setCarrierId] = useState("");
  const [destination, setDestination] = useState("LAL Motors Yard");
  const [reason, setReason] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => vehicles.filter((v) => selected.includes(v.id)), [vehicles, selected]);
  const total = chosen.reduce((s, v) => s + (Number(prices[v.id]) || 0), 0);

  const canConfirm =
    !busy &&
    selected.length > 0 &&
    !!carrierId &&
    (!redispatch || !!reason) &&
    chosen.every((v) => prices[v.id] !== "" && prices[v.id] !== undefined);

  function confirm() {
    setBusy(true);
    const jobId = createDispatch({
      carrierId,
      destination,
      vehicleIds: selected,
      prices,
      locations,
    });
    setBusy(false);
    onDone(jobId);
  }

  return (
    <section className="max-w-3xl space-y-4">
      <h3 className="text-base font-semibold">{redispatch ? "Re-Dispatch Vehicle" : "Create Dispatch"}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Carrier</Label>
          <Select value={carrierId} onValueChange={(v) => setCarrierId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select saved carrier" />
            </SelectTrigger>
            <SelectContent>
              {carriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.company} · {c.driver}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onAddCarrier}>
            + Add New Carrier
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label>Delivery destination</Label>
          <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
        </div>
        {redispatch && (
          <div className="space-y-1.5">
            <Label>Required reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose reason" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {selected.length} vehicles selected · Total transportation ${total.toFixed(2)}
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Lot #</th>
              <th className="p-2">VIN</th>
              <th className="p-2">Vehicle</th>
              <th className="p-2">Pickup location</th>
              <th className="p-2">PIN</th>
              <th className="p-2">Transport price</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {chosen.map((v) => (
              <tr key={v.id}>
                <td className="p-2">{v.lotNumber || "—"}</td>
                <td className="p-2">{v.vin || "—"}</td>
                <td className="p-2">
                  {v.year} {v.make} {v.model}
                </td>
                <td className="p-2">
                  <Input
                    aria-label={`Pickup location ${v.lotNumber || v.vin}`}
                    value={locations[v.id] ?? v.location ?? ""}
                    onChange={(e) => setLocations({ ...locations, [v.id]: e.target.value })}
                  />
                </td>
                <td className="p-2">{v.pickupPin || "—"}</td>
                <td className="p-2">
                  <Input
                    aria-label={`Price ${v.lotNumber || v.vin}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={prices[v.id] ?? ""}
                    onChange={(e) => setPrices({ ...prices, [v.id]: e.target.value })}
                  />
                </td>
                <td className="p-2">{v.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button disabled={!canConfirm} onClick={confirm}>
        Confirm {redispatch ? "Re-Dispatch" : "Dispatch"} &amp; Generate BOL
      </Button>
    </section>
  );
}
