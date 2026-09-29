"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import type { ScrapLoad } from "@/lib/mock/scrap";

const clock = (s: string) => new Date(s).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function LoadCard({ load, isDriver, isOpen, onToggle }: { load: ScrapLoad; isDriver: boolean; isOpen: boolean; onToggle: () => void }) {
  const { saveTicket, saveMeasurements } = useScrapData();
  const [ticketFile, setTicketFile] = useState("");
  const [weight, setWeight] = useState(String(load.weightAmount ?? ""));
  const [amount, setAmount] = useState(String(load.amount ?? ""));
  const [ticketNumber, setTicketNumber] = useState(load.ticketNumber ?? "");

  const statusLabel = load.checkId ? "Check recorded" : load.ticketUploadedAt ? "Yard ticket uploaded" : "Ticket photo needed";

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/20">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Camera className="size-5" />
        </div>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm">{isDriver ? "My scrap load" : load.driverName}</strong>
          <small className="block text-xs text-muted-foreground">
            {clock(load.createdAt)} · Load {load.id.slice(0, 8)}
          </small>
          <small className="block text-xs text-muted-foreground">{statusLabel}</small>
        </span>
        <strong className="shrink-0 text-xs font-semibold text-primary">{isOpen ? "Close" : "Open load"}</strong>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="flex items-center justify-between">
            <strong className="text-sm">
              Load {load.id.slice(0, 8)} · {load.driverName}
            </strong>
            <StatusBadge>{load.checkId ? "CHECK RECORDED" : load.ticketUploadedAt ? "TICKET UPLOADED" : "AWAITING TICKET"}</StatusBadge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-center text-xs">
              <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                <Camera className="size-5" />
              </div>
              Load photo
            </div>
            {load.ticketUploadedAt ? (
              <div className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-center text-xs">
                <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                  <Camera className="size-5" />
                </div>
                Yard ticket
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
                Ticket photo pending
              </div>
            )}
            {load.checkId && (
              <div className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-center text-xs">
                <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                  <Camera className="size-5" />
                </div>
                Check #{load.checkNumber}
              </div>
            )}
          </div>

          {!load.ticketUploadedAt && (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <h4 className="text-sm font-semibold">Step 2 · Yard ticket for this load</h4>
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
                <Camera className="size-4" /> {ticketFile || "Take or upload yard ticket photo"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setTicketFile(e.target.files?.[0]?.name || "")} />
              </label>
              <Button
                size="sm"
                disabled={!ticketFile}
                onClick={() => {
                  saveTicket(load.id);
                  setTicketFile("");
                }}
              >
                Save ticket to this load
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <span>{load.weightAmount !== null ? `Weight: ${load.weightAmount.toLocaleString()} lb` : "Weight pending"}</span>
            <span>{load.amount !== null ? `Amount: $${load.amount.toFixed(2)}` : "Amount pending"}</span>
            {load.ticketNumber && <span>Ticket #{load.ticketNumber}</span>}
            {load.checkNumber && <span>Check #{load.checkNumber}</span>}
          </div>

          {!isDriver && load.ticketUploadedAt && (
            <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Weight (lb)</Label>
                <Input type="number" min={0} step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount ($)</Label>
                <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Ticket number</Label>
                <Input value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} />
              </div>
              <Button size="sm" className="sm:col-span-3 sm:w-fit" onClick={() => saveMeasurements(load.id, weight, amount, ticketNumber)}>
                Save load details
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
