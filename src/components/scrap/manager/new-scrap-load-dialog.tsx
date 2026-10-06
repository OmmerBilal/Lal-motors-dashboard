"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOfficeLoadMutations, useScrapDrivers } from "@/lib/query/scrap";
import { yardDay } from "@/components/scrap/scrap-shared";

/**
 * New Scrap Load. The office opens a load and assigns the Scrap Driver before it starts. The load is operational
 * at once (status New, shown under Open Loads). The server dates it to today's yard day and records who created it
 * and when. Only the driver is asked for: the schema has no other load fields, so none are invented here.
 */
export function NewScrapLoadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const drivers = useScrapDrivers(open);
  const { createLoad } = useOfficeLoadMutations();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const list = drivers.data ?? [];
  const selected = list.find((d) => d.id === driverId) ?? null;

  function reset() {
    setDriverId(null);
    setRequestId(crypto.randomUUID());
    setError(null);
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function save() {
    if (!driverId) return;
    setError(null);
    try {
      await createLoad.mutateAsync({ driverId, requestId });
      toast.success(`Scrap load created and assigned to ${selected?.name ?? "the driver"}`);
      close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The load was not created. Nothing was saved.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Scrap Load</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Load date: today ({yardDay()}). The load is Open until the assigned driver starts it.</p>
          <div className="space-y-1.5">
            <span className="font-medium">Assigned Scrap Driver <span className="text-destructive">*</span></span>
            <Select value={driverId ?? ""} onValueChange={(v) => v && setDriverId(v)} disabled={createLoad.isPending}>
              <SelectTrigger className="h-10 w-full" aria-label="Assigned Scrap Driver">
                <SelectValue placeholder={drivers.isPending ? "Loading drivers…" : "Choose an active driver"}>
                  {(v: string) => list.find((d) => d.id === v)?.name ?? (drivers.isPending ? "Loading drivers…" : "Choose an active driver")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {list.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {drivers.isError && <p role="alert" className="text-xs text-destructive">{drivers.error.message}</p>}
            {drivers.isSuccess && list.length === 0 && (
              <p className="text-xs text-muted-foreground">No active Scrap Driver accounts. Add one under Users first.</p>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-11 w-full" disabled={!driverId || createLoad.isPending} onClick={save}>
            {createLoad.isPending ? "Creating…" : "Create & Assign"}
          </Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => close(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
