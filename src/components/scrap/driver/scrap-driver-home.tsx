"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, ClipboardList, LogOut, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import type { DriverLoad } from "@/lib/data/scrap";
import { useDriverLoads } from "@/lib/query/scrap";
import { CheckFlow, LoadDetailFlow, MyLoadsFlow, NewLoadFlow, assignedStatusLabel, loadRef } from "@/components/scrap/driver/driver-load-flows";
import { timeLabel, yardDay } from "@/components/scrap/scrap-shared";

type DriverView = { name: "home" } | { name: "new" } | { name: "load"; id: string } | { name: "loads" } | { name: "check" };

/**
 * Scrap Driver home. Evidence only: the driver never sees or enters a weight, rate, amount, payment
 * or manager note. Every number here is a count of the driver's own loads, read from the database.
 */
export function ScrapDriverHome({ user }: { user: User }) {
  const { signOut: endSession } = useSession();
  const [view, setView] = useState<DriverView>({ name: "home" });
  const loads = useDriverLoads();
  const rows: DriverLoad[] = loads.data?.pages.flatMap((p) => p.rows) ?? [];

  const firstName = user.name.split(" ")[0];
  const today = yardDay();
  const todays = rows.filter((l) => l.load_date === today);
  const awaitingTicket = rows.filter((l) => l.driver_state === "awaiting_ticket").length;
  // The most recent load that is not yet complete is the one to resume.
  const active = rows.find((l) => l.driver_state !== "complete") ?? null;

  if (view.name === "new") {
    return <NewLoadFlow onBack={() => setView({ name: "home" })} onDone={(id) => { toast.success("Load saved."); setView({ name: "load", id }); }} />;
  }
  if (view.name === "load") {
    return <LoadDetailFlow loadId={view.id} onBack={() => setView({ name: "home" })} onNextLoad={() => setView({ name: "new" })} />;
  }
  if (view.name === "loads") {
    return <MyLoadsFlow onBack={() => setView({ name: "home" })} onOpen={(id) => setView({ name: "load", id })} />;
  }
  if (view.name === "check") {
    return <CheckFlow onBack={() => setView({ name: "home" })} />;
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 pb-6">
      <header className="rounded-xl bg-brand p-5 text-brand-foreground">
        <p className="text-lg font-semibold">Hello, {firstName}</p>
        <p className="text-sm text-brand-foreground/70">Scrap Driver</p>
        <p className="text-xs text-brand-foreground/60">
          {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </p>
      </header>

      {loads.isError && <p className="text-sm text-destructive">{loads.error.message}</p>}

      <div className="grid grid-cols-3 gap-2">
        <StatTile icon={Truck} value={todays.length} label="Loads Today" tone="info" />
        <StatTile icon={CheckCircle2} value={todays.filter((l) => l.driver_state === "complete").length} label="Complete" tone="success" />
        <StatTile icon={ClipboardList} value={awaitingTicket} label="Need Ticket" tone="warning" />
      </div>

      {active && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Active load</p>
          <p className="mt-1 text-sm font-medium">{assignedStatusLabel(active)}</p>
          <Button className="mt-3 w-full" onClick={() => setView({ name: "load", id: active.id })}>
            Continue Active Load
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">My Assigned Scrap Loads</h3>
        {!loads.isPending && rows.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No loads assigned to you yet.</p>}
        {rows.slice(0, 10).map((l) => (
          <button
            key={l.id}
            onClick={() => setView({ name: "load", id: l.id })}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/30"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">Load {loadRef(l.id)} · {l.load_date}</span>
              <span className="block text-xs text-muted-foreground">Assigned {timeLabel(l.assigned_at ?? l.created_at)}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">{assignedStatusLabel(l)}</span>
          </button>
        ))}
      </section>

      <div className="space-y-3">
        <ActionCard tone="success" icon={Camera} title="New Load" subtitle="Take a photo when loaded" onClick={() => setView({ name: "new" })} />
        <ActionCard
          tone="info"
          icon={ClipboardList}
          title="Add Ticket"
          subtitle={active && active.driver_state !== "complete" ? "Continue the active load" : "No load is waiting for a ticket"}
          disabled={!active || active.driver_state === "saved"}
          onClick={() => active && setView({ name: "load", id: active.id })}
        />
        <ActionCard
          tone="brand"
          icon={CheckCircle2}
          title="Complete Load"
          subtitle="Finish the active load once the ticket is in"
          disabled={!active || active.driver_state !== "ticket_attached"}
          onClick={() => active && setView({ name: "load", id: active.id })}
        />
        <ActionCard tone="brand" icon={CheckCircle2} title="Add Check" subtitle="Photo of a check you received" onClick={() => setView({ name: "check" })} />
        <ActionCard tone="neutral" icon={Truck} title="My Loads" subtitle="Your saved loads" onClick={() => setView({ name: "loads" })} />
      </div>

      <Button variant="outline" className="w-full" onClick={() => void endSession()}>
        <LogOut className="size-4" /> Log Out
      </Button>
      <p className="pt-2 text-center text-[11px] text-muted-foreground">Drive · Recycle · A Cleaner Tomorrow</p>
    </div>
  );
}

function StatTile({ icon: Icon, value, label, tone }: { icon: typeof Truck; value: number; label: string; tone: "info" | "success" | "warning" }) {
  const toneClasses = { info: "text-primary bg-primary/10", success: "text-success bg-success/10", warning: "text-warning-foreground bg-warning/15" }[tone];
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-3 text-center">
      <span className={`flex size-8 items-center justify-center rounded-md ${toneClasses}`}>
        <Icon className="size-4" />
      </span>
      <span className="text-lg leading-none font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function ActionCard({
  tone,
  icon: Icon,
  title,
  subtitle,
  onClick,
  disabled = false,
}: {
  tone: "success" | "info" | "brand" | "neutral";
  icon: typeof Truck;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const toneClasses = {
    success: "bg-success text-success-foreground",
    info: "bg-primary text-primary-foreground",
    brand: "bg-accent-gold text-accent-gold-foreground",
    neutral: "bg-muted text-foreground",
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-4 text-left shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40 ${toneClasses}`}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold">{title}</span>
        <span className="block text-xs opacity-80">{subtitle}</span>
      </span>
    </button>
  );
}
