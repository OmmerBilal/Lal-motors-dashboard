"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchScrapThumbnailUrls } from "@/lib/data/scrap";
import { toast } from "sonner";
import { ArrowLeft, Camera, CheckCircle2, Container, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaCapture } from "@/components/media/media-capture";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useLoaderDetail, useLoaderList, useLoaderMutations, invalidateContainers } from "@/lib/query/containers";
import { useQuery } from "@tanstack/react-query";
import type { LoaderContainer } from "@/lib/data/containers";
import { PhotoTile } from "@/components/scrap/scrap-shared";

type LoaderView = { name: "home" } | { name: "open" } | { name: "container"; id: string } | { name: "ready"; id: string };

/**
 * Container Loading Employee. Loading evidence and loading completion only: no consignee, invoice,
 * price, payment or balance exists in anything this screen receives.
 */
export function ContainerLoaderApp() {
  const [view, setView] = useState<LoaderView>({ name: "home" });
  if (view.name === "container") {
    return <LoaderContainerView id={view.id} onBack={() => setView({ name: "home" })} onReady={() => setView({ name: "ready", id: view.id })} />;
  }
  if (view.name === "ready") {
    return <ReadyView id={view.id} onNext={() => setView({ name: "home" })} />;
  }
  return <LoaderHome onOpen={(id) => setView({ name: "container", id })} />;
}

function LoaderHome({ onOpen }: { onOpen: (id: string) => void }) {
  const { open } = useLoaderMutations();
  const list = useLoaderList("all");
  const rows: LoaderContainer[] = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const active = rows.find((r) => r.status === "loading") ?? null;
  const ready = rows.filter((r) => r.status !== "loading").length;
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  function startContainer() {
    open.mutate(requestId, {
      onSuccess: (c) => {
        setRequestId(crypto.randomUUID());
        toast.success(`Container ${c.t_ref} is open for loading.`);
        onOpen(c.id);
      },
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-5 pb-6">
      <header className="rounded-xl bg-brand p-5 text-brand-foreground">
        <p className="text-lg font-semibold">Container Loading</p>
        <p className="text-sm text-brand-foreground/70">Loading evidence and completion</p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Open to load" value={rows.filter((r) => r.status === "loading").length} />
        <Stat label="Loading finished" value={ready} />
      </div>

      {active && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Continue active container</p>
          <p className="mt-1 text-base font-semibold">{active.t_ref}</p>
          <p className="text-xs text-muted-foreground">{active.container_number ?? "Number not confirmed yet"}</p>
          <Button className="mt-3 w-full" onClick={() => onOpen(active.id)}>
            <Container className="size-4" /> Continue
          </Button>
        </div>
      )}

      <Button className="w-full" variant={active ? "outline" : "default"} disabled={open.isPending} onClick={startContainer}>
        <Plus className="size-4" /> {open.isPending ? "Opening…" : "Start / Open Container"}
      </Button>

      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">My containers</p>
        {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {list.isError && <p className="text-sm text-destructive">{list.error.message}</p>}
        {!list.isPending && rows.length === 0 && <EmptyState icon={Container} title="No containers yet" description="Start a container to begin loading." />}
        {rows.map((r) => (
          <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent/30">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{r.t_ref}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.container_number ?? "Number not confirmed"}</span>
            </span>
            {r.status === "loading" ? <StatusBadge tone="info">Loading</StatusBadge> : <StatusBadge tone="success">Finished</StatusBadge>}
          </button>
        ))}
      </div>
      {list.hasNextPage && (
        <Button variant="outline" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

function LoaderContainerView({ id, onBack, onReady }: { id: string; onBack: () => void; onReady: () => void }) {
  const qc = useQueryClient();
  const detail = useLoaderDetail(id);
  const { confirmNumber, finish } = useLoaderMutations();
  const [number, setNumber] = useState("");
  const [slots, setSlots] = useState<number[]>([0]);
  const nextSlot = useRef(1);
  const c = detail.data?.container;
  const photosAll = detail.data?.photos ?? [];
  const thumbs = useQuery({
    queryKey: ["containers", "thumbs", id, photosAll.map((p) => p.id).join(",")],
    queryFn: () => fetchScrapThumbnailUrls(photosAll.map((p) => p.id)),
    enabled: photosAll.length > 0,
    staleTime: 60_000,
  });

  if (detail.isPending) return <p className="p-4 text-sm text-muted-foreground">Loading container…</p>;
  if (!c) return <p className="p-4 text-sm text-destructive">{detail.error?.message ?? "This container could not be opened."}</p>;

  const photos = detail.data?.photos ?? [];
  const numberPhoto = photos.find((p) => p.role === "number_photo");
  const loadingPhotos = photos.filter((p) => p.role === "loading_photo");
  const finalPhotos = photos.filter((p) => p.role === "final_list");
  const finished = c.status !== "loading";
  const canFinish = !finished && c.number_confirmed && loadingPhotos.length > 0 && finalPhotos.length > 0;

  return (
    <div className="mx-auto w-full max-w-md space-y-5 pb-6">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{c.t_ref}</h2>
          <p className="text-xs text-muted-foreground">{c.container_number ?? "Official number not confirmed"}</p>
        </div>
        {finished ? <StatusBadge tone="success">Finished</StatusBadge> : <StatusBadge tone="info">Loading</StatusBadge>}
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">1 · Container number</p>
        {numberPhoto ? (
          <div className="flex items-center gap-3">
            <PhotoTile url={thumbs.data?.[numberPhoto.id]} size="size-16" label="Container number photo" />
            <p className="text-sm">Photo saved.</p>
          </div>
        ) : finished ? (
          <p className="text-sm text-muted-foreground">No number photo was attached.</p>
        ) : (
          <MediaCapture
            label="Container number photo"
            ownerType="container"
            ownerId={id}
            role="number_photo"
            onUploaded={() => invalidateContainers(qc)}
          />
        )}
        {!finished && (
          <div className="space-y-2 pt-1">
            <Label className="text-xs">Official container number (4 letters, 7 digits)</Label>
            <div className="flex gap-2">
              <Input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="MSCU1234567" disabled={!numberPhoto} />
              <Button
                disabled={!numberPhoto || confirmNumber.isPending || number.trim().length === 0}
                onClick={() =>
                  confirmNumber.mutate({ id, number }, { onSuccess: () => toast.success("Container number confirmed."), onError: (e) => toast.error(e.message) })
                }
              >
                Confirm
              </Button>
            </div>
            {c.number_confirmed && <p className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" /> Confirmed: {c.container_number}</p>}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">2 · Loading photos ({loadingPhotos.length})</p>
        {slots.map((s) => (
          <MediaCapture
            key={s}
            label={`Loading photo ${loadingPhotos.length + slots.indexOf(s) + 1}`}
            ownerType="container"
            ownerId={id}
            role="loading_photo"
            disabled={finished}
            onUploaded={() => invalidateContainers(qc)}
          />
        ))}
        {!finished && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setSlots((xs) => [...xs, nextSlot.current++])}>
            <Camera className="size-4" /> Add another loading photo
          </Button>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">3 · Final loading list</p>
        {finalPhotos.length > 0 ? (
          <p className="text-sm">Final list saved ({finalPhotos.length}).</p>
        ) : finished ? (
          <p className="text-sm text-muted-foreground">No final list was attached.</p>
        ) : (
          <MediaCapture label="Final loading list photo" ownerType="container" ownerId={id} role="final_list" onUploaded={() => invalidateContainers(qc)} />
        )}
      </section>

      {!finished && (
        <Button
          className="w-full"
          disabled={!canFinish || finish.isPending}
          onClick={() =>
            finish.mutate(
              { id, requestId: crypto.randomUUID() },
              { onSuccess: (done) => { if (done.status === "ready_for_invoice") onReady(); }, onError: (e) => toast.error(e.message) }
            )
          }
        >
          {finish.isPending ? "Finishing…" : "Mark Loading Finished"}
        </Button>
      )}
      {!finished && !canFinish && <p className="text-xs text-muted-foreground">Confirm the number, add a loading photo and the final list to finish.</p>}
      {finished && <Button variant="outline" className="w-full" onClick={onBack}>Back to containers</Button>}
    </div>
  );
}

function ReadyView({ id, onNext }: { id: string; onNext: () => void }) {
  const detail = useLoaderDetail(id);
  const c = detail.data?.container;
  return (
    <div className="mx-auto w-full max-w-md space-y-5 pb-6 text-center">
      <CheckCircle2 className="mx-auto size-14 text-success" />
      <h2 className="text-xl font-semibold">Ready for invoice</h2>
      <p className="text-sm text-muted-foreground">{c ? `${c.t_ref} · ${c.container_number ?? ""}` : "Loading finished."}</p>
      <Button className="w-full" onClick={onNext}>Next container</Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
