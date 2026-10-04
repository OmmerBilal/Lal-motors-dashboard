"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useReport } from "@/lib/query/scrap";
import { lbs, usd, yardDay } from "@/components/scrap/scrap-shared";

type Preset = "today" | "week" | "month" | "custom";
type DriverOption = { driver_id: string; name: string };

/** Management reporting. Every figure is an aggregate computed in the database for the chosen range. */
export function ReportsPanel({ drivers }: { drivers: DriverOption[] }) {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === "today") return { from: yardDay(), to: yardDay() };
    if (preset === "week") return { from: yardDay(6), to: yardDay() };
    if (preset === "month") return { from: yardDay(29), to: yardDay() };
    return { from: customFrom || yardDay(), to: customTo || yardDay() };
  }, [preset, customFrom, customTo]);
  const valid = range.from <= range.to;
  const report = useReport(range.from, range.to, driverId);
  const r = report.data;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1">
          <Label className="text-xs">Range</Label>
          <Select value={preset} onValueChange={(v) => setPreset((v as Preset) ?? "today")}>
            <SelectTrigger className="w-40">
              <SelectValue>{(v: Preset) => ({ today: "Today", week: "Last 7 days", month: "Last 30 days", custom: "Custom" })[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <>
            <Input type="date" className="w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <Input type="date" className="w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Driver</Label>
          <Select value={driverId ?? "all"} onValueChange={(v) => setDriverId(!v || v === "all" ? null : v)}>
            <SelectTrigger className="w-48">
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
      </section>

      {!valid && <p className="text-sm text-destructive">The end date must be on or after the start date.</p>}
      {report.isPending && valid && <p className="text-sm text-muted-foreground">Calculating…</p>}
      {report.isError && <p className="text-sm text-destructive">{report.error.message}</p>}

      {r && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Loads" value={r.loads} />
            <Stat label="Completed" value={r.completed} />
            <Stat label="Weight" value={lbs(r.weight)} />
            <Stat label="Amount" value={usd(r.amount)} />
            <Stat label="Received" value={usd(r.payments_received)} />
            <Stat label="Discrepancies opened" value={r.discrepancies_opened} />
            <Stat label="Open discrepancies now" value={r.discrepancies_open_now} />
            <Stat label="Tire/rim still owed (aluminum / steel)" value={`${r.tire_rim_outstanding_aluminum} / ${r.tire_rim_outstanding_steel}`} />
          </section>

          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Reconciliation (loads in range)</h3>
            {Object.keys(r.reconciliation).length === 0 ? (
              <EmptyState title="No loads in this range." />
            ) : (
              <div className="flex flex-wrap gap-2 text-sm">
                {Object.entries(r.reconciliation).map(([k, n]) => (
                  <span key={k} className="rounded-md border border-border px-3 py-1">
                    {k.replaceAll("_", " ")}: <b className="tabular-nums">{n}</b>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">By driver</h3>
            {r.by_driver.length === 0 ? (
              <EmptyState title="No driver activity in this range." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead className="text-right">Loads</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.by_driver.map((d) => (
                    <TableRow key={d.driver_id}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.loads}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{lbs(d.weight)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Daily closes in range</h3>
            {r.daily_closes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No day closed in this range.</p>
            ) : (
              <ul className="text-sm">
                {r.daily_closes.map((c) => (
                  <li key={c.date}>
                    {c.date} · {c.override ? "closed with override" : "closed"}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
