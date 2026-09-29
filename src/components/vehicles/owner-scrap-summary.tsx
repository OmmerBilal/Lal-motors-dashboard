"use client";

import { useRouter } from "next/navigation";
import { Camera, ChevronRight, Truck } from "lucide-react";
import { cash } from "@/lib/mock/vehicles";
import { scrapLoadsToday, scrapTotalsToday } from "@/lib/mock/scrap-today";

const displayTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function OwnerScrapSummary() {
  const router = useRouter();

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5" aria-label="Scrap Load Activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Owner dashboard · Today
          </p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Truck className="size-5 text-primary" /> Scrap Load Activity
          </h3>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          onClick={() => router.push("/scrap")}
        >
          Open Scrap Loads <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Loads today", value: scrapTotalsToday.loads },
          { label: "Awaiting yard ticket", value: scrapTotalsToday.pendingTickets },
          { label: "Recorded weight", value: `${scrapTotalsToday.weight.toLocaleString()} lb` },
          { label: "Recorded amount", value: cash(scrapTotalsToday.amount) },
        ].map((m) => (
          <button
            key={m.label}
            type="button"
            onClick={() => router.push("/scrap")}
            className="rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-primary/40"
          >
            <p className="text-xl font-semibold tabular-nums">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.label}</p>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold">Recent loads</p>
        {scrapLoadsToday.length ? (
          <div className="divide-y divide-border rounded-md border border-border">
            {scrapLoadsToday.slice(0, 5).map((load) => (
              <button
                key={load.id}
                type="button"
                onClick={() => router.push("/scrap")}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
              >
                <Camera className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {load.driverName} · {displayTime(load.createdAt)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Load {load.id.slice(0, 8)} ·{" "}
                    {load.checkId
                      ? "Check recorded"
                      : load.ticketUploadedAt
                        ? load.ticketNumber
                          ? `Ticket #${load.ticketNumber}`
                          : "Ticket uploaded"
                        : "Ticket photo pending"}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No scrap loads recorded today.</p>
        )}
      </div>
    </section>
  );
}
