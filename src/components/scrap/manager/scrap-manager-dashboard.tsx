"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, DollarSign, Recycle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { useScrapData } from "@/components/scrap/scrap-data-context";
import { DriverCard } from "@/components/scrap/manager/driver-card";
import { LoadDetailSheet } from "@/components/scrap/manager/load-detail-sheet";
import { PaymentPanel } from "@/components/scrap/manager/payment-panel";
import { TireShopPanel } from "@/components/scrap/manager/tire-shop-panel";
import { DailyClosePanel } from "@/components/scrap/manager/daily-close-panel";
import {
  effectiveLoadStatus,
  loadAmount,
  loadStatusLabels,
  paymentStatusLabel,
  periodRange,
  isToday,
  type PeriodId,
  type ScrapLoad,
} from "@/lib/mock/scrap";

export function ScrapManagerDashboard({ user, onOpenUsers }: { user: User; onOpenUsers?: () => void }) {
  const { loads, payments, drivers } = useScrapData();
  const [period, setPeriod] = useState<PeriodId>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(drivers[0]?.id ?? null);
  const [selectedLoad, setSelectedLoad] = useState<ScrapLoad | null>(null);

  const range = periodRange(period, { from: customFrom, to: customTo });
  const periodLoads = useMemo(() => loads.filter((l) => l.loadDate >= range.from && l.loadDate <= range.to), [loads, range.from, range.to]);

  const todayLoads = loads.filter((l) => isToday(l.createdAt));
  const openLoads = periodLoads.filter((l) => l.status === "new" || l.status === "ready_for_review");
  const pendingApprovals = periodLoads.filter((l) => l.status === "ready_for_review");
  const completedToday = todayLoads.filter((l) => l.status === "approved" || l.status === "closed");
  const missingEvidence = periodLoads.filter((l) => effectiveLoadStatus(l) === "ticket_missing" || !l.loadPhoto);
  const weekLoads = loads.filter((l) => l.loadDate >= periodRange("week").from);
  const paymentPending = loads.filter((l) => paymentStatusLabel(l) === "Payment Pending");
  const discrepancies = payments.filter((p) => !p.discrepancyReason && Math.abs(p.amountReceived - periodLoads.filter((l) => l.paymentId === p.id).reduce((n, l) => n + loadAmount(l), 0)) > 0.01 && p.linkedLoadIds.length);

  const driverStats = drivers.map((d) => {
    const dLoads = todayLoads.filter((l) => l.driverId === d.id);
    return { ...d, loadsToday: dLoads.length, weight: dLoads.reduce((n, l) => n + (l.weight || 0), 0), amount: dLoads.reduce((n, l) => n + loadAmount(l), 0) };
  });

  const selectedDriver = drivers.find((d) => d.id === selectedDriverId);
  const driverLoads = useMemo(
    () => (selectedDriverId ? periodLoads.filter((l) => l.driverId === selectedDriverId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : []),
    [periodLoads, selectedDriverId]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-success/10 text-success">
            <Recycle className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">Scrap Module</h2>
            <p className="text-sm text-muted-foreground">Manage scrap yard loads, driver activity, payments, and tire/rim returns</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod((v as PeriodId) ?? "today")}>
            <SelectTrigger className="w-36">
              <SelectValue>
                {(value: PeriodId) =>
                  ({ today: "Today", week: "This Week", month: "This Month", custom: "Custom" })[value] ?? "Today"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard icon={Truck} tone="#2563eb" value={openLoads.length} label="Open Loads" hint="Awaiting review" />
        <SummaryCard icon={Clock} tone="#d97706" value={pendingApprovals.length} label="Pending Approvals" hint="Ticket in, needs review" />
        <SummaryCard icon={CheckCircle2} tone="#16a34a" value={completedToday.length} label="Completed Today" hint={`${completedToday.reduce((n, l) => n + (l.weight || 0), 0).toLocaleString()} lbs · $${completedToday.reduce((n, l) => n + loadAmount(l), 0).toFixed(2)}`} />
        <SummaryCard icon={AlertTriangle} tone="#dc2626" value={missingEvidence.length} label="Missing Photos/Tickets" hint="Needs attention" />
        <SummaryCard icon={DollarSign} tone="#7c3aed" value={weekLoads.length} label="Total This Week" hint={`${weekLoads.reduce((n, l) => n + (l.weight || 0), 0).toLocaleString()} lbs · $${weekLoads.reduce((n, l) => n + loadAmount(l), 0).toFixed(2)}`} />
      </div>

      <p className="text-xs text-muted-foreground">
        Payment Pending: <b className="text-foreground">{paymentPending.length} load(s)</b> · Payment Discrepancies:{" "}
        <b className={discrepancies.length ? "text-destructive" : "text-foreground"}>{discrepancies.length}</b>
      </p>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Scrap Drivers (Today) · Driver activity and load count</h3>
        {drivers.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {driverStats.map((d) => (
              <DriverCard
                key={d.id}
                name={d.name}
                loadsToday={d.loadsToday}
                totalWeight={d.weight}
                totalAmount={d.amount}
                active={selectedDriverId === d.id}
                onViewLoads={() => setSelectedDriverId(d.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No active Scrap Driver account exists yet.</p>
            {onOpenUsers && (
              <Button size="sm" onClick={onOpenUsers}>
                Open Users &amp; Activity
              </Button>
            )}
          </div>
        )}
      </div>

      <TireShopPanel actorName={user.name} />

      {selectedDriver && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">{selectedDriver.name.split(" ")[0]} — Loads</h3>
          {driverLoads.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Load Photo</TableHead>
                  <TableHead>Ticket Photo</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driverLoads.map((l, i) => (
                  <TableRow key={l.id}>
                    <TableCell>{driverLoads.length - i}</TableCell>
                    <TableCell>{new Date(l.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</TableCell>
                    <TableCell>{l.loadPhoto ? "✓" : "—"}</TableCell>
                    <TableCell>{l.ticketPhoto ? "✓" : "—"}</TableCell>
                    <TableCell>{l.weight != null ? l.weight.toLocaleString() : "—"}</TableCell>
                    <TableCell>{l.rate != null ? `$${l.rate}` : "—"}</TableCell>
                    <TableCell>{l.amount != null ? `$${loadAmount(l).toFixed(2)}` : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge>{loadStatusLabels[effectiveLoadStatus(l)].toUpperCase()}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge>{paymentStatusLabel(l).toUpperCase()}</StatusBadge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelectedLoad(l)}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No loads in this range for this driver." />
          )}

          {selectedDriver && <div className="mt-4"><PaymentPanel driverId={selectedDriver.id} driverName={selectedDriver.name} actorName={user.name} /></div>}
        </div>
      )}

      <DailyClosePanel actorName={user.name} />

      <LoadDetailSheet load={selectedLoad} open={!!selectedLoad} onOpenChange={(o) => !o && setSelectedLoad(null)} actorName={user.name} />
    </div>
  );
}

function SummaryCard({ icon: Icon, tone, value, label, hint }: { icon: typeof Truck; tone: string; value: number; label: string; hint?: string }) {
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
