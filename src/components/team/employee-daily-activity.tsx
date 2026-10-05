"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDayActivity } from "@/lib/query/team";
import { yardDay } from "@/components/scrap/scrap-shared";

/** One employee's real activity for one day: parts they captured and the vehicle actions they recorded. */
export function EmployeeDailyActivity({ member, onClose }: { member: { id: string; name: string }; onClose: () => void }) {
  const [date, setDate] = useState(yardDay());
  const day = useDayActivity(member.id, date);
  const parts = day.data?.parts ?? [];
  const actions = day.data?.actions ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{member.name} · Daily activity</h3>
          <p className="text-xs text-muted-foreground">
            {day.isPending ? "Loading…" : `${parts.length} parts captured on ${date}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mb-4 max-w-xs space-y-1.5">
        <Label className="text-xs">Select day</Label>
        <Input type="date" value={date} max={yardDay()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      {day.isError && <p className="text-sm text-destructive">{day.error.message}</p>}
      <div className="space-y-2">
        {parts.map((p) => (
          <article key={p.id} className="rounded-md border border-border p-2.5">
            <b className="block text-sm">{p.part_name || "Pending identification"}</b>
            <small className="block text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()} · {p.status}</small>
          </article>
        ))}
        {day.isSuccess && !parts.length && <p className="text-sm text-muted-foreground">No parts captured on this day.</p>}
      </div>
      <h4 className="mt-4 mb-2 text-sm font-semibold">Recorded vehicle actions ({actions.length})</h4>
      <div className="space-y-1.5">
        {actions.map((a) => (
          <p key={a.id} className="text-sm">
            <b>{a.action.replaceAll("_", " ")}</b> <small className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</small>
          </p>
        ))}
        {day.isSuccess && !actions.length && <p className="text-sm text-muted-foreground">No vehicle actions recorded on this day.</p>}
      </div>
    </div>
  );
}
