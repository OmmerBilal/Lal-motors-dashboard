"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Camera, CheckCircle2, ClipboardList, LogOut, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useSession } from "@/lib/session";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/types";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { CameraStep } from "@/components/scrap/driver/camera-step";
import { driverDisplayStatus, isToday, type ScrapLoad } from "@/lib/mock/scrap";

type DriverView = "home" | "new_load" | "add_ticket" | "add_ticket_pick" | "add_check" | "my_loads";

export function ScrapDriverHome({
  user,
  previewMode = false,
  previewDriverId,
}: {
  user: User;
  previewMode?: boolean;
  previewDriverId?: string;
}) {
  const { loads, drivers, createLoad, addTicketPhoto, submitCheckPhoto } = useScrapData();
  const { setUserId, users } = useSession();
  const router = useRouter();
  const [view, setView] = useState<DriverView>("home");
  const [pendingTicketLoadId, setPendingTicketLoadId] = useState<string | null>(null);

  const driverId = previewMode ? previewDriverId || user.id : user.id;
  const driverName = previewMode ? drivers.find((d) => d.id === driverId)?.name || user.name : user.name;
  const firstName = driverName.split(" ")[0];

  const myLoads = useMemo(
    () => loads.filter((l) => l.driverId === driverId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [loads, driverId]
  );
  const loadsToday = myLoads.filter((l) => isToday(l.createdAt));
  const loadsMissingTicket = myLoads.filter((l) => !l.ticketPhoto);

  function signOut() {
    setUserId(users[0].id);
    router.push("/login");
  }

  function startNewLoad() {
    if (!driverId) return;
    setView("new_load");
  }

  function saveNewLoad() {
    createLoad(driverId, driverName);
    toast.success("Load saved. Open My Loads to add the yard ticket once you're back.");
    setView("my_loads");
  }

  function startAddTicket() {
    if (loadsMissingTicket.length === 0) {
      toast.info("No loads are waiting on a ticket photo right now.");
      return;
    }
    if (loadsMissingTicket.length === 1) {
      setPendingTicketLoadId(loadsMissingTicket[0].id);
      setView("add_ticket");
      return;
    }
    setView("add_ticket_pick");
  }

  function saveTicket() {
    if (!pendingTicketLoadId) return;
    addTicketPhoto(pendingTicketLoadId);
    toast.success("Ticket photo saved to this load.");
    setPendingTicketLoadId(null);
    setView("my_loads");
  }

  function saveCheck() {
    submitCheckPhoto(driverId, driverName);
    toast.success("Check photo saved. Your manager will reconcile payment.");
    setView("home");
  }

  if (view === "home") {
    return (
      <div className="mx-auto w-full max-w-md space-y-5 pb-6">
        <header className="rounded-xl bg-brand p-5 text-brand-foreground">
          <p className="text-lg font-semibold">Good Morning, {firstName}</p>
          <p className="text-sm text-brand-foreground/70">Driver</p>
          <p className="text-xs text-brand-foreground/60">
            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </p>
        </header>

        <div className="grid grid-cols-3 gap-2">
          <StatTile icon={Truck} value={loadsToday.length} label="Loads Today" tone="info" />
          <StatTile icon={CheckCircle2} value={loadsToday.filter((l) => l.ticketPhoto).length} label="Tickets Added" tone="success" />
          <StatTile icon={ClipboardList} value={loadsMissingTicket.length} label="Need Ticket" tone="warning" />
        </div>

        <div className="space-y-3">
          <ActionCard tone="success" icon={Camera} title="New Load" subtitle="Take photo when loaded" onClick={startNewLoad} />
          <ActionCard tone="info" icon={ClipboardList} title="Add Ticket" subtitle="Take photo of ticket" onClick={startAddTicket} />
          <ActionCard tone="brand" icon={CheckCircle2} title="Add Check" subtitle="Take photo of check (end of day)" onClick={() => setView("add_check")} />
          <ActionCard tone="neutral" icon={Truck} title="My Loads Today" subtitle="View your loads" onClick={() => setView("my_loads")} />
        </div>

        <Button variant="outline" className="w-full" onClick={signOut}>
          <LogOut className="size-4" /> Log Out
        </Button>
        <p className="pt-2 text-center text-[11px] text-muted-foreground">Drive · Recycle · A Cleaner Tomorrow</p>
      </div>
    );
  }

  const back = (
    <Button variant="ghost" size="sm" onClick={() => setView("home")}>
      <ArrowLeft className="size-4" /> Back
    </Button>
  );

  if (view === "new_load") {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        {back}
        <div>
          <h2 className="text-lg font-semibold">New Load</h2>
          <p className="text-sm text-muted-foreground">Step 1 of 2 · Take Load Photo</p>
        </div>
        <CameraStep
          tone="success"
          title="Take a photo of your loaded vehicle"
          instruction="Make sure the whole load is visible"
          saveLabel="Save Photo"
          onSave={saveNewLoad}
        />
      </div>
    );
  }

  if (view === "add_ticket_pick") {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        {back}
        <h2 className="text-lg font-semibold">Select a load</h2>
        <div className="space-y-2">
          {loadsMissingTicket.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setPendingTicketLoadId(l.id);
                setView("add_ticket");
              }}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-accent/30"
            >
              <span className="text-sm font-medium">{new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              <StatusBadge tone="warning">Ticket Needed</StatusBadge>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (view === "add_ticket") {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        {back}
        <div>
          <h2 className="text-lg font-semibold">Add Ticket</h2>
          <p className="text-sm text-muted-foreground">Step 2 of 2 · Take Ticket Photo</p>
        </div>
        <CameraStep
          tone="info"
          title="Take a photo of the scrap ticket"
          instruction="Make sure all information is visible"
          saveLabel="Save Ticket"
          onSave={saveTicket}
        />
      </div>
    );
  }

  if (view === "add_check") {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        {back}
        <div>
          <h2 className="text-lg font-semibold">Add Check (End of Day)</h2>
          <p className="text-sm text-muted-foreground">Take a photo of the check you received</p>
        </div>
        <CameraStep tone="brand" title="Photograph the company check" instruction="One check can cover multiple loads" saveLabel="Save Check" onSave={saveCheck} />
      </div>
    );
  }

  // My Loads
  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      {back}
      <div>
        <h2 className="text-lg font-semibold">My Loads Today</h2>
        <p className="text-sm text-muted-foreground">View your saved loads</p>
      </div>
      {myLoads.length ? (
        <div className="space-y-2">
          {myLoads.map((l, i) => (
            <DriverLoadRow key={l.id} index={myLoads.length - i} load={l} onAddTicket={() => { setPendingTicketLoadId(l.id); setView("add_ticket"); }} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Truck} title="No loads yet" description="Tap New Load on the home screen to get started." />
      )}
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
}: {
  tone: "success" | "info" | "brand" | "neutral";
  icon: typeof Truck;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const toneClasses = {
    success: "bg-success text-success-foreground",
    info: "bg-primary text-primary-foreground",
    brand: "bg-accent-gold text-accent-gold-foreground",
    neutral: "bg-muted text-foreground",
  }[tone];
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-4 py-4 text-left shadow-xs transition-opacity hover:opacity-90 ${toneClasses}`}>
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

function DriverLoadRow({ index, load, onAddTicket }: { index: number; load: ScrapLoad; onAddTicket: () => void }) {
  const status = driverDisplayStatus(load);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Camera className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Load {index}</p>
        <p className="text-xs text-muted-foreground">{new Date(load.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
      </div>
      {status === "Load Photo Saved" ? (
        <Button size="sm" variant="outline" onClick={onAddTicket}>
          Add Ticket
        </Button>
      ) : (
        <StatusBadge tone="success">{status}</StatusBadge>
      )}
    </div>
  );
}
