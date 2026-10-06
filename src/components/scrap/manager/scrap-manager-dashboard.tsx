"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, DollarSign, Plus, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { useManagerLoads, useManagerSummary } from "@/lib/query/scrap";
import type { LoadBucket, ManagerLoad } from "@/lib/data/scrap";
import { DriverCard } from "@/components/scrap/manager/driver-card";
import { LoadDetailSheet } from "@/components/scrap/manager/load-detail-sheet";
import { NewScrapLoadDialog } from "@/components/scrap/manager/new-scrap-load-dialog";
import { PaymentsPanel } from "@/components/scrap/manager/payment-panel";
import { TireShopPanel } from "@/components/scrap/manager/tire-shop-panel";
import { DailyClosePanel } from "@/components/scrap/manager/daily-close-panel";
import { ReportsPanel } from "@/components/scrap/manager/reports-panel";
import { DiscrepanciesPanel } from "@/components/scrap/manager/discrepancies-panel";
import { lbs, managerStateLabel, paymentStatusLabelText, timeLabel, usd, yardDay } from "@/components/scrap/scrap-shared";

type Period = "today" | "week" | "month" | "custom";
type Section = "loads" | "payments" | "discrepancies" | "tire_rim" | "daily_close" | "reports";

const BUCKETS: { id: LoadBucket; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "awaiting_ticket", label: "Awaiting Ticket" },
  { id: "needs_review", label: "Needs Review" },
  { id: "completed", label: "Completed" },
  { id: "discrepancy", label: "Discrepancies" },
  { id: "unpaid", label: "Unpaid" },
];

const SECTIONS: { id: Section; label: string }[] = [
  { id: "loads", label: "Loads" },
  { id: "payments", label: "Payments" },
  { id: "discrepancies", label: "Discrepancies" },
  { id: "tire_rim", label: "Tire / Rim" },
  { id: "daily_close", label: "Daily Close" },
  { id: "reports", label: "Reports" },
];

export function ScrapManagerDashboard({ user, onOpenUsers }: { user: User; onOpenUsers?: () => void }) {
  const [period, setPeriod] = useState<Period>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [section, setSection] = useState<Section>("loads");
  const [bucket, setBucket] = useState<LoadBucket>("all");
  const [driverId, setDriverId] = useState<string | null>(null);
  const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null);
  const [newLoadOpen, setNewLoadOpen] = useState(false);
  // Creating and assigning loads is office authority (server-checked too). Auction and others do not see the button.
  const canCreateLoad = user.role === "owner" || user.role === "engineer_admin" || user.role === "manager";

  const range = useMemo(() => {
    if (period === "today") return { from: yardDay(), to: yardDay() };
    if (period === "week") return { from: yardDay(6), to: yardDay() };
    if (period === "month") return { from: yardDay(29), to: yardDay() };
    return { from: customFrom || yardDay(), to: customTo || yardDay() };
  }, [period, customFrom, customTo]);
  const rangeValid = range.from <= range.to;

  const summary = useManagerSummary(range.from, range.to);
  // The driver list covers a year, so a driver with no loads in the chosen period still appears for payments.
  const yearSummary = useManagerSummary(yardDay(365), yardDay());
  const drivers = yearSummary.data?.by_driver ?? [];
  const loads = useManagerLoads({ bucket, from: range.from, to: range.to, driverId });
  const rows: ManagerLoad[] = loads.data?.pages.flatMap((p) => p.rows) ?? [];
  const s = summary.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-success/10 text-success">
            <Recycle className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Scrap Management</h2>
            <p className="text-sm text-muted-foreground">Loads, reconciliation, discrepancies, tire and rim obligations, and daily close</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateLoad && (
            <Button className="h-9" onClick={() => setNewLoadOpen(true)}>
              <Plus className="size-4" /> New Scrap Load
            </Button>
          )}
          <Select value={period} onValueChange={(v) => setPeriod((v as Period) ?? "today")}>
            <SelectTrigger className="w-36">
              <SelectValue>{(value: Period) => ({ today: "Today", week: "Last 7 days", month: "Last 30 days", custom: "Custom" })[value] ?? "Today"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <>
              <Input type="date" className="w-36" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <Input type="date" className="w-36" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          )}
        </div>
      </div>

      {!rangeValid && <p className="text-sm text-destructive">The end date must be on or after the start date.</p>}
      {summary.isError && <p className="text-sm text-destructive">{summary.error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Truck} tone="#2563eb" value={s?.open_now ?? "—"} label="Open Loads" hint="New or awaiting review" />
        <SummaryCard icon={Clock} tone="#d97706" value={s?.awaiting_ticket_now ?? "—"} label="Awaiting Ticket" hint={`${s?.ticket_missing_now ?? 0} past their day`} />
        <SummaryCard icon={CheckCircle2} tone="#16a34a" value={s?.needs_review_now ?? "—"} label="Needs Review" hint={`${s?.completed_in_range ?? 0} completed in range`} />
        <SummaryCard icon={AlertTriangle} tone="#dc2626" value={s?.discrepancies_open_now ?? "—"} label="Open Discrepancies" hint={`${s?.payment_pending_now ?? 0} payment(s) pending`} />
        <SummaryCard icon={DollarSign} tone="#7c3aed" value={usd(s?.amount_in_range ?? null)} label="Completed Amount" hint={`${lbs(s?.weight_in_range ?? null)} · ${s?.loads_in_range ?? 0} loads`} />
        <SummaryCard icon={DollarSign} tone="#0891b2" value={usd(s?.payments_received_in_range ?? null)} label="Received in Range" hint="Payments, excluding corrections" />
        <SummaryCard
          icon={Recycle}
          tone="#b45309"
          value={s ? `${s.tire_rim_remaining_aluminum} / ${s.tire_rim_remaining_steel}` : "—"}
          label="Tire/Rim Outstanding"
          hint={`${s?.tire_rim_open_obligations ?? 0} open obligation(s) · aluminum / steel`}
        />
        <SummaryCard icon={CheckCircle2} tone={s?.day_closed_today ? "#16a34a" : "#64748b"} value={s ? (s.day_closed_today ? "Closed" : "Open") : "—"} label="Today's Close" hint="Owner or engineer admin may override" />
      </div>

      {(s?.by_driver?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Drivers in range</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {s!.by_driver.map((d) => (
              <DriverCard
                key={d.driver_id}
                name={d.name}
                loadsToday={d.loads}
                totalWeight={d.weight}
                totalAmount={d.amount}
                active={driverId === d.driver_id}
                onViewLoads={() => {
                  setDriverId(d.driver_id);
                  setSection("loads");
                }}
              />
            ))}
          </div>
        </div>
      )}
      {s && s.by_driver.length === 0 && !onOpenUsers && <p className="text-sm text-muted-foreground">No loads in this range.</p>}
      {s && s.by_driver.length === 0 && onOpenUsers && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No loads in this range yet.</p>
          <Button size="sm" onClick={onOpenUsers}>Open Users &amp; Activity</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            onClick={() => setSection(x.id)}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${section === x.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {section === "loads" && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            {BUCKETS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBucket(b.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${bucket === b.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {b.label}
              </button>
            ))}
            <Select value={driverId ?? "all"} onValueChange={(v) => setDriverId(!v || v === "all" ? null : v)}>
              <SelectTrigger className="ml-auto w-44">
                <SelectValue>{(v: string) => (v === "all" ? "All drivers" : drivers.find((d) => d.driver_id === v)?.name ?? "Driver")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All drivers</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.driver_id} value={d.driver_id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loads.isPending && <p className="text-sm text-muted-foreground">Loading loads…</p>}
          {loads.isError && <p className="text-sm text-destructive">{loads.error.message}</p>}
          {!loads.isPending && rows.length === 0 && <EmptyState title="No loads match this view." />}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.load_date}</TableCell>
                      <TableCell>{timeLabel(l.created_at)}</TableCell>
                      <TableCell>{l.driver_name}</TableCell>
                      <TableCell>
                        <StatusBadge>{managerStateLabel[l.state].toUpperCase()}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{lbs(l.weight)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(l.amount)}</TableCell>
                      <TableCell>{paymentStatusLabelText[l.payment_status]}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.open_discrepancies || "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedLoadId(l.id)}>
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {loads.hasNextPage && (
            <Button variant="outline" className="w-full" disabled={loads.isFetchingNextPage} onClick={() => loads.fetchNextPage()}>
              {loads.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      )}

      {section === "payments" && <PaymentsPanel drivers={drivers} />}
      {section === "discrepancies" && <DiscrepanciesPanel />}
      {section === "tire_rim" && <TireShopPanel />}
      {section === "daily_close" && <DailyClosePanel role={user.role} defaultDate={yardDay()} />}
      {section === "reports" && <ReportsPanel drivers={drivers} />}

      <LoadDetailSheet loadId={selectedLoadId} open={!!selectedLoadId} onOpenChange={(o) => !o && setSelectedLoadId(null)} />
      {canCreateLoad && <NewScrapLoadDialog open={newLoadOpen} onOpenChange={setNewLoadOpen} />}
    </div>
  );
}

function SummaryCard({ icon: Icon, tone, value, label, hint }: { icon: typeof Truck; tone: string; value: number | string; label: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" style={{ backgroundColor: `${tone}0f` }}>
      <span className="flex size-9 items-center justify-center rounded-md" style={{ backgroundColor: `${tone}26`, color: tone }}>
        <Icon className="size-5" />
      </span>
      <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
