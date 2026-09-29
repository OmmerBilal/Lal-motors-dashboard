"use client";

import { useState } from "react";
import { Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDispatchData } from "@/components/central-dispatch/dispatch-data-context";
import { buildBol, dispatchStatusFlow, type DispatchItem } from "@/lib/mock/central-dispatch";
import { toast } from "sonner";

export function JobView({
  jobId,
  canEdit,
  onArrive,
}: {
  jobId: string;
  canEdit: boolean;
  onArrive: (vehicleId: string) => void;
}) {
  const { jobs, advanceItemStatus, addNote } = useDispatchData();
  const job = jobs.find((j) => j.id === jobId);
  const [note, setNote] = useState("");

  if (!job) return null;
  const activeJobId = job.id;
  const bol = buildBol(job);
  const arrivedCount = job.items.filter((i) => i.status === "Arrived").length;

  function nextStatusButton(item: DispatchItem) {
    if (item.status === "In Transit") {
      return (
        <Button size="sm" onClick={() => onArrive(item.vehicleId)}>
          Confirm Arrival
        </Button>
      );
    }
    const next = dispatchStatusFlow[item.status];
    if (!next || !canEdit) return null;
    return (
      <Button size="sm" variant="outline" onClick={() => advanceItemStatus(activeJobId, item.vehicleId, next)}>
        {next}
      </Button>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          Dispatch {job.id.slice(0, 8)} · {job.status}
        </h3>
        <StatusBadge>
          {`${arrivedCount} of ${job.items.length} Delivered${job.status === "Partial Delivery" ? " — PARTIAL DELIVERY" : ""}`}
        </StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">
        Carrier: {job.company} · {job.driver} · {job.phone} · {job.email || "Email missing"}
      </p>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Lot / VIN</th>
              <th className="p-2">Vehicle</th>
              <th className="p-2">Pickup</th>
              <th className="p-2">Price</th>
              <th className="p-2">Status / action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {job.items.map((x) => (
              <tr key={x.id}>
                <td className="p-2">
                  {x.lotNumber || "—"}
                  <br />
                  <span className="text-xs text-muted-foreground">{x.vin || "—"}</span>
                </td>
                <td className="p-2">
                  {x.year} {x.make} {x.model}
                </td>
                <td className="p-2">{x.pickupLocation || "—"}</td>
                <td className="p-2">${Number(x.price).toFixed(2)}</td>
                <td className="p-2">
                  <div className="flex flex-col items-start gap-1.5">
                    <StatusBadge>{x.status}</StatusBadge>
                    {nextStatusButton(x)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-md border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-sm font-medium">Preview Dispatch / BOL</summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{bol}</pre>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const w = window.open("", "_blank");
            if (w) {
              w.document.write(
                `<title>LAL Motors Dispatch</title><pre style="font:15px/1.5 system-ui;white-space:pre-wrap">${bol
                  .replaceAll("&", "&amp;")
                  .replaceAll("<", "&lt;")}</pre>`
              );
              w.document.close();
              w.print();
            }
          }}
        >
          <Printer /> Print / Save PDF
        </Button>
        {canEdit && (
          <Button variant="outline" disabled={!job.email} onClick={() => toast.success("BOL sent to carrier.")}>
            <Mail /> Email to Carrier
          </Button>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Follow-up notes</h4>
        <Textarea
          aria-label="Follow-up note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Called driver — remaining vehicles expected Friday"
        />
        <Button
          className="mt-2"
          disabled={!note}
          onClick={() => {
            addNote(job.id, note);
            setNote("");
          }}
        >
          Save dated note
        </Button>
        <div className="mt-3 space-y-1.5">
          {job.notes.map((n) => (
            <p key={n.id} className="text-sm text-muted-foreground">
              {n.actorName} · {new Date(n.createdAt).toLocaleString()} — {n.note}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
