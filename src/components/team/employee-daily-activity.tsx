"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parts } from "@/lib/mock/parts";
import { vehicleEvents } from "@/lib/mock/vehicles";
import { localDay } from "@/lib/mock/scrap";
import type { TeamMember } from "@/lib/mock/team";

export function EmployeeDailyActivity({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [date, setDate] = useState(localDay());

  const captures = useMemo(
    () => parts.filter((p) => p.capturedByName === member.name && p.createdAt.slice(0, 10) === date),
    [member.name, date]
  );
  const actions = useMemo(
    () => vehicleEvents.filter((e) => e.actorId === member.id && e.createdAt.slice(0, 10) === date),
    [member.id, date]
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{member.name} · Daily activity</h3>
          <p className="text-xs text-muted-foreground">
            {captures.length} parts captured on {date}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mb-4 max-w-xs space-y-1.5">
        <Label className="text-xs">Select day</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-2">
        {captures.map((p) => (
          <article key={p.id} className="flex items-start gap-3 rounded-md border border-border p-2.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">Photo</div>
            <div>
              <b className="block text-sm">{p.draft.partName || "Pending identification"}</b>
              <small className="block text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()} · {p.status}</small>
              <small className="block text-xs text-muted-foreground">Record {p.id}</small>
            </div>
          </article>
        ))}
        {!captures.length && <p className="text-sm text-muted-foreground">No parts captured on this day.</p>}
      </div>
      <h4 className="mt-4 mb-2 text-sm font-semibold">Other recorded actions ({actions.length})</h4>
      <div className="space-y-1.5">
        {actions.map((a, i) => (
          <p key={`${a.id}-${i}`} className="text-sm">
            <b>{a.action.replaceAll("_", " ")}</b>{" "}
            <small className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</small>
          </p>
        ))}
        {!actions.length && <p className="text-sm text-muted-foreground">No other actions recorded on this day.</p>}
      </div>
    </div>
  );
}
