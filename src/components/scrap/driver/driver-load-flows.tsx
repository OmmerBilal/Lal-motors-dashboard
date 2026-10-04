"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ClipboardList, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaCapture } from "@/components/media/media-capture";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDriverLoad, useDriverLoads, useDriverMutations, useScrapThumbnails } from "@/lib/query/scrap";
import type { DriverLoad } from "@/lib/data/scrap";
import { PhotoTile, driverStateLabel, timeLabel, usePhotoUrl, dateLabel } from "@/components/scrap/scrap-shared";

/** Shared top bar for a driver screen. */
export function DriverBack({ onBack, label = "Back" }: { onBack: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft className="size-4" /> {label}
    </Button>
  );
}

/**
 * New Load: the load row is created the moment this screen opens (persisted immediately, retry-safe
 * with one request id). The load photo is uploaded through the media API and then attached by the
 * server. "Save Load" is only offered once the server has accepted the photo.
 */
export function NewLoadFlow({ onDone, onBack }: { onDone: (loadId: string) => void; onBack: () => void }) {
  const { createLoad, attachPhoto } = useDriverMutations();
  const [load, setLoad] = useState<DriverLoad | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createLoad.mutate(requestId, {
      onSuccess: (l) => setLoad(l),
      onError: (e) => toast.error(e.message),
    });
    // The request id is stable for this screen, so a re-render never creates a second load.
  }, [createLoad, requestId]);

  if (!load) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <DriverBack onBack={onBack} />
        <p className="text-sm text-muted-foreground">{createLoad.isError ? "The load could not be started. Go back and try again." : "Starting the load…"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <DriverBack onBack={onBack} />
      <div>
        <h2 className="text-lg font-semibold">New Load</h2>
        <p className="text-sm text-muted-foreground">Take a photo of the loaded vehicle. The load is already saved.</p>
      </div>
      {load.has_load_photo ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Load photo saved.
        </div>
      ) : (
        <MediaCapture
          label="Load photo"
          ownerType="scrap_load"
          ownerId={load.id}
          role="load_photo"
          onUploaded={(mediaId) =>
            attachPhoto.mutate(
              { loadId: load.id, kind: "load", mediaId },
              {
                onSuccess: (updated) => {
                  setLoad(updated);
                  toast.success("Load photo saved to this load.");
                },
                onError: (e) => toast.error(e.message),
              }
            )
          }
        />
      )}
      <Button className="w-full" disabled={!load.has_load_photo} onClick={() => onDone(load.id)}>
        Save Load
      </Button>
    </div>
  );
}

/** Load detail: the next required step for this load, and nothing else. */
export function LoadDetailFlow({ loadId, onBack, onNextLoad }: { loadId: string; onBack: () => void; onNextLoad: () => void }) {
  const loadQuery = useDriverLoad(loadId);
  const { attachPhoto, markDelivered, completeLoad } = useDriverMutations();
  const load = loadQuery.data ?? null;
  const loadPhoto = usePhotoUrl(load?.load_photo_asset_id ?? null, "medium");
  const ticketPhoto = usePhotoUrl(load?.ticket_photo_asset_id ?? null, "medium");

  if (loadQuery.isPending) return <p className="text-sm text-muted-foreground">Loading load…</p>;
  if (!load) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <DriverBack onBack={onBack} />
        <EmptyState icon={Truck} title="This load is not available." />
      </div>
    );
  }

  const stateTone = load.driver_state === "complete" ? "success" : load.driver_state === "awaiting_ticket" ? "warning" : "info";
  const canDeliver = load.driver_state === "saved" && load.has_load_photo;
  const canTicket = load.driver_state === "awaiting_ticket" || (load.driver_state === "ticket_attached" && !load.has_ticket_photo);
  const canComplete = load.driver_state === "ticket_attached" && load.has_ticket_photo && !!load.delivered_at;

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-6">
      <DriverBack onBack={onBack} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Load · {timeLabel(load.created_at)}</h2>
          <p className="text-xs text-muted-foreground">{dateLabel(load.load_date)}</p>
        </div>
        <StatusBadge tone={stateTone}>{driverStateLabel[load.driver_state]}</StatusBadge>
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">1 · Load photo</p>
        <div className="flex items-center gap-3">
          <PhotoTile url={loadPhoto.data} size="size-20" label="Load photo" />
          <p className="text-sm">{load.has_load_photo ? "Saved" : "Not taken yet"}</p>
        </div>
        {canDeliver && (
          <Button className="w-full" onClick={() => markDelivered.mutate(load.id, { onSuccess: () => toast.success("Load marked delivered. Add the ticket photo next."), onError: (e) => toast.error(e.message) })}>
            <Truck className="size-4" /> Mark Delivered
          </Button>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">2 · Ticket photo</p>
        {load.has_ticket_photo ? (
          <div className="flex items-center gap-3">
            <PhotoTile url={ticketPhoto.data} size="size-20" label="Ticket photo" />
            <p className="text-sm">Ticket saved.</p>
          </div>
        ) : canTicket ? (
          <MediaCapture
            label="Ticket photo"
            ownerType="scrap_load"
            ownerId={load.id}
            role="ticket_photo"
            onUploaded={(mediaId) =>
              attachPhoto.mutate(
                { loadId: load.id, kind: "ticket", mediaId },
                { onSuccess: () => toast.success("Ticket photo saved to this load."), onError: (e) => toast.error(e.message) }
              )
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">Mark the load delivered first, then add the ticket.</p>
        )}
      </section>

      {load.driver_state === "complete" ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Completed. Your manager will review it.
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={!canComplete || completeLoad.isPending}
          onClick={() => completeLoad.mutate(load.id, { onSuccess: () => toast.success("Load completed. It is with your manager for review."), onError: (e) => toast.error(e.message) })}
        >
          <ClipboardList className="size-4" /> {completeLoad.isPending ? "Completing…" : "Complete Load"}
        </Button>
      )}

      {load.driver_state === "complete" && (
        <Button variant="outline" className="w-full" onClick={onNextLoad}>
          Next Load
        </Button>
      )}
    </div>
  );
}

/** My Loads: the driver's own loads, keyset-paged, with thumbnails from one batched request per page. */
export function MyLoadsFlow({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const loads = useDriverLoads();
  const rows = loads.data?.pages.flatMap((p) => p.rows) ?? [];
  const thumbs = useScrapThumbnails(rows.map((r) => r.load_photo_asset_id).filter((x): x is string => !!x));

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-6">
      <DriverBack onBack={onBack} />
      <div>
        <h2 className="text-lg font-semibold">My Loads</h2>
        <p className="text-sm text-muted-foreground">Your saved loads, newest first</p>
      </div>
      {loads.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {loads.isError && <p className="text-sm text-destructive">{loads.error.message}</p>}
      {!loads.isPending && rows.length === 0 && <EmptyState icon={Truck} title="No loads yet" description="Tap New Load to start." />}
      <div className="space-y-2">
        {rows.map((l) => (
          <button key={l.id} onClick={() => onOpen(l.id)} className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/30">
            <PhotoTile url={l.load_photo_asset_id ? thumbs.data?.[l.load_photo_asset_id] : null} label="Load photo" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{timeLabel(l.created_at)} · {dateLabel(l.load_date)}</span>
              <span className="block text-xs text-muted-foreground">{driverStateLabel[l.driver_state]}</span>
            </span>
          </button>
        ))}
      </div>
      {loads.hasNextPage && (
        <Button variant="outline" className="w-full" disabled={loads.isFetchingNextPage} onClick={() => loads.fetchNextPage()}>
          {loads.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

/** Add Check (end of day): evidence only. The driver photographs the check; no amount is entered. */
export function CheckFlow({ onBack }: { onBack: () => void }) {
  const { createCheck, attachCheckPhoto } = useDriverMutations();
  const [requestId] = useState(() => crypto.randomUUID());
  const [checkId, setCheckId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createCheck.mutate(requestId, { onSuccess: (c) => setCheckId(c.id), onError: (e) => toast.error(e.message) });
  }, [createCheck, requestId]);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <DriverBack onBack={onBack} />
      <div>
        <h2 className="text-lg font-semibold">Add Check</h2>
        <p className="text-sm text-muted-foreground">Photograph the check you received. Your manager enters the amount and reconciles it.</p>
      </div>
      {saved ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Check photo saved. Your manager will reconcile payment.
        </div>
      ) : checkId ? (
        <MediaCapture
          label="Check photo"
          ownerType="driver_check"
          ownerId={checkId}
          role="check_photo"
          onUploaded={(mediaId) =>
            attachCheckPhoto.mutate(
              { checkId, mediaId },
              { onSuccess: () => { setSaved(true); toast.success("Check photo saved."); }, onError: (e) => toast.error(e.message) }
            )
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">{createCheck.isError ? "The check could not be started. Go back and try again." : "Starting…"}</p>
      )}
    </div>
  );
}
