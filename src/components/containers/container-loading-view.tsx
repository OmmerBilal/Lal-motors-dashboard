"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  Container as ContainerIcon,
  ListChecks,
  LogOut,
  PartyPopper,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { PhotoCapture } from "@/components/containers/photo-capture";
import { useContainersData } from "@/components/containers/containers-data-context";
import { containerStatusLabels, type LoaderSafeContainer } from "@/lib/mock/containers";
import { useSession } from "@/lib/session";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/types";

type Screen = "home" | "my-containers" | "select" | "detail" | "number-photo" | "add-photo" | "final-list" | "finish-confirm" | "success";

function statusTone(status: LoaderSafeContainer["status"]) {
  if (status === "loading") return "warning" as const;
  if (status === "ready_for_invoice") return "info" as const;
  if (status === "on_the_way") return "success" as const;
  return "neutral" as const;
}

function suggestNumber(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 999999;
  return `MSCU${String(1000000 + h).slice(0, 7)}`;
}

export function ContainerLoadingView({ user, previewMode = false }: { user: User; previewMode?: boolean }) {
  const { loaderJobs, confirmContainerNumber, addFile, markLoadingFinished } = useContainersData();
  const { setUserId, users } = useSession();
  const router = useRouter();

  const [screen, setScreen] = useState<Screen>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [detailTab, setDetailTab] = useState<"photos" | "list" | "details">("photos");
  const [numberDraft, setNumberDraft] = useState("");
  const [finishMissing, setFinishMissing] = useState<string[] | null>(null);

  const employeeName = user.name;
  const selected = selectedId ? loaderJobs.find((j) => j.id === selectedId) : null;

  const filtered = useMemo(() => {
    let list = loaderJobs;
    if (filter === "open") list = list.filter((j) => j.status === "loading");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((j) => j.tRef.toLowerCase().includes(q) || j.containerNumber.toLowerCase().includes(q));
    }
    return list;
  }, [loaderJobs, filter, search]);

  function openContainer(id: string) {
    setSelectedId(id);
    setDetailTab("photos");
    setScreen("detail");
  }

  function logout() {
    setUserId(users[0].id);
    router.push("/login");
  }

  function saveNumberPhoto() {
    if (!selected) return;
    const aiSuggested = numberDraft === suggestNumber(selected.id);
    const res = confirmContainerNumber(selected.id, numberDraft, employeeName, aiSuggested);
    if (!res.ok) {
      toast.error(res.error || "Could not save container number");
      return;
    }
    toast.success(`Container number confirmed for ${selected.tRef}`);
    setScreen("detail");
    setDetailTab("details");
  }

  function saveLoadingPhoto() {
    if (!selected) return;
    const n = selected.files.filter((f) => f.kind === "loading_photo").length + 1;
    addFile(selected.id, "loading_photo", `Loading photo ${n}`, employeeName);
    toast.success(`Saved to ${selected.tRef}`);
    setScreen("detail");
    setDetailTab("photos");
  }

  function saveFinalList() {
    if (!selected) return;
    addFile(selected.id, "final_list", "Final Loading List", employeeName);
    toast.success("Final loading list saved");
    setScreen("detail");
    setDetailTab("list");
  }

  function tryFinish() {
    if (!selected) return;
    const res = markLoadingFinished(selected.id, employeeName);
    if (!res.ok) {
      setFinishMissing(res.missing);
      return;
    }
    setFinishMissing(null);
    setScreen("success");
  }

  // --- HOME -------------------------------------------------------------
  if (screen === "home") {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <div className="rounded-lg bg-brand p-5 text-brand-foreground">
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-gold uppercase">Employee App</p>
          <h2 className="mt-1 text-xl font-semibold">{previewMode ? "Container Loading (Owner Preview)" : `Welcome, ${employeeName}`}</h2>
          <p className="mt-1 text-sm text-brand-foreground/70">Select Container → Take Photo → Save → Repeat.</p>
        </div>
        <button
          onClick={() => {
            setFilter("open");
            setScreen("select");
          }}
          className="flex w-full items-center gap-3 rounded-lg bg-primary p-4 text-left text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white/15">
            <Camera className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Container Loading</span>
            <span className="block text-xs text-primary-foreground/75">Take photos &amp; update</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0" />
        </button>
        <button
          onClick={() => setScreen("my-containers")}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent/30"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
            <ListChecks className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">View My Containers</span>
            <span className="block text-xs text-muted-foreground">All containers you&apos;ve worked on</span>
          </span>
          <ChevronRight className="ml-auto size-4 shrink-0" />
        </button>
        <Button variant="outline" className="w-full" onClick={logout}>
          <LogOut className="size-4" /> Logout
        </Button>
      </div>
    );
  }

  // --- MY CONTAINERS ------------------------------------------------------
  if (screen === "my-containers") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("home")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold">My Containers</h2>
        </div>
        <div className="space-y-2">
          {loaderJobs.map((j) => (
            <button key={j.id} onClick={() => openContainer(j.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/30">
              <span>
                <span className="block text-sm font-semibold">{j.tRef}</span>
                <span className="block text-xs text-muted-foreground">{j.containerNumber || "Number pending"}</span>
              </span>
              <StatusBadge tone={statusTone(j.status)}>{containerStatusLabels[j.status]}</StatusBadge>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- SELECT CONTAINER -----------------------------------------------------
  if (screen === "select") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("home")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Select Container</h2>
            <p className="text-xs text-muted-foreground">Choose the container you are loading</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "open" ? "default" : "outline"} onClick={() => setFilter("open")}>
            Loading / Open
          </Button>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            All
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search container number…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {filtered.length ? (
          <div className="space-y-2">
            {filtered.map((j) => (
              <button key={j.id} onClick={() => openContainer(j.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/30">
                <span>
                  <span className="block text-sm font-semibold">
                    {j.tRef} <span className="font-normal text-muted-foreground">{j.containerNumber}</span>
                  </span>
                </span>
                <StatusBadge tone={statusTone(j.status)}>{containerStatusLabels[j.status]}</StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={Boxes} title="No containers match" />
        )}
      </div>
    );
  }

  if (!selected) {
    return <EmptyState icon={ContainerIcon} title="Select a container to continue" action={<Button onClick={() => setScreen("select")}>Select Container</Button>} />;
  }

  const loadingPhotos = selected.files.filter((f) => f.kind === "loading_photo");
  const numberPhoto = selected.files.find((f) => f.kind === "number_photo");
  const finalList = selected.files.find((f) => f.kind === "final_list");

  // --- CONTAINER DETAIL -------------------------------------------------
  if (screen === "detail") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("select")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Container {selected.tRef}</h2>
            <StatusBadge tone={statusTone(selected.status)}>{containerStatusLabels[selected.status]}</StatusBadge>
          </div>
        </div>

        <div className="flex gap-1 rounded-md bg-muted p-1 text-xs font-medium">
          {(["photos", "list", "details"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDetailTab(t)}
              className={`flex-1 rounded px-2 py-1.5 capitalize transition-colors ${detailTab === t ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
            >
              {t === "list" ? `Loading List (${finalList ? 1 : 0})` : t === "photos" ? `Photos (${loadingPhotos.length})` : "Details"}
            </button>
          ))}
        </div>

        {detailTab === "details" && (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Container No.</p>
                <p className="font-semibold">{selected.containerNumber || "Not confirmed"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="font-semibold">{selected.startedAt ? new Date(selected.startedAt).toLocaleDateString() : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground"># of Photos</p>
                <p className="font-semibold">{loadingPhotos.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Final List</p>
                <p className="font-semibold">{finalList ? "Added" : "Not added"}</p>
              </div>
            </div>
            {!numberPhoto && (
              <Button className="w-full" onClick={() => setScreen("number-photo")}>
                <Camera className="size-4" /> Add Container Number Photo
              </Button>
            )}
            {numberPhoto && (
              <Button variant="outline" className="w-full" onClick={() => setScreen("add-photo")}>
                <Camera className="size-4" /> Add Photo
              </Button>
            )}
          </div>
        )}

        {detailTab === "photos" && (
          <div className="space-y-2">
            {selected.files
              .filter((f) => f.kind !== "final_list")
              .map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    <Camera className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.caption}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(f.createdAt).toLocaleString()} · By: {f.employeeName}
                    </span>
                  </span>
                </div>
              ))}
            <Button className="w-full" onClick={() => setScreen(numberPhoto ? "add-photo" : "number-photo")}>
              <Camera className="size-4" /> {numberPhoto ? "Add Another Photo" : "Add Container Number Photo"}
            </Button>
          </div>
        )}

        {detailTab === "list" && (
          <div className="space-y-2">
            {finalList ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <Camera className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{finalList.caption}</span>
                  <span className="block text-[11px] text-muted-foreground">{new Date(finalList.createdAt).toLocaleString()}</span>
                </span>
              </div>
            ) : (
              <EmptyState title="No final loading list yet" description="Take a photo of the final written loading sheet once loading is complete." />
            )}
            <Button className="w-full" disabled={!loadingPhotos.length} onClick={() => setScreen("final-list")}>
              <Camera className="size-4" /> {finalList ? "Replace Final Loading List" : "Add Final Loading List"}
            </Button>
          </div>
        )}

        {selected.status === "loading" && (
          <Button size="lg" className="w-full bg-success text-success-foreground hover:bg-success/90" onClick={() => setScreen("finish-confirm")}>
            <Check className="size-4" /> Mark Loading Finished
          </Button>
        )}
        {selected.status !== "loading" && (
          <p className="rounded-md bg-muted/60 p-3 text-center text-xs text-muted-foreground">
            Loading is finished for this container. Evidence is locked — contact Export Management for changes.
          </p>
        )}
      </div>
    );
  }

  // --- NUMBER PHOTO -------------------------------------------------------
  if (screen === "number-photo") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("detail")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold">Container {selected.tRef}</h2>
        </div>
        <PhotoCapture
          title="Take Container Number Photo"
          subtitle="Make sure the full container number is visible"
          saveLabel="Use This Photo"
          onSave={() => setNumberDraft((v) => v || suggestNumber(selected.id))}
        />
        {numberDraft !== "" && (
          <div className="space-y-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> AI Suggested (Demo) — confirm or edit
            </div>
            <Input value={numberDraft} onChange={(e) => setNumberDraft(e.target.value)} placeholder="Enter container number" />
            <Button className="w-full" disabled={!numberDraft.trim()} onClick={saveNumberPhoto}>
              <Check className="size-4" /> Confirm &amp; Save
            </Button>
          </div>
        )}
      </div>
    );
  }

  // --- ADD LOADING PHOTO ---------------------------------------------------
  if (screen === "add-photo") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("detail")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold">Container {selected.tRef}</h2>
        </div>
        <PhotoCapture title="Take Photo" subtitle="Loading photo" saveLabel={`Save to ${selected.tRef}`} onSave={saveLoadingPhoto} onCancel={() => setScreen("detail")} />
      </div>
    );
  }

  // --- FINAL LOADING LIST ---------------------------------------------------
  if (screen === "final-list") {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setScreen("detail")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold">Final Loading List</h2>
        </div>
        <PhotoCapture title="Take Photo" subtitle="Photo of the final written loading sheet" saveLabel="Save Final List" onSave={saveFinalList} onCancel={() => setScreen("detail")} />
      </div>
    );
  }

  // --- FINISH CONFIRM ---------------------------------------------------
  if (screen === "finish-confirm") {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <div className="rounded-lg border border-border bg-card p-5 text-center">
          <Check className="mx-auto size-10 rounded-full bg-success/15 p-2 text-success" />
          <h2 className="mt-3 text-lg font-semibold">Loading Complete?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Make sure all photos are uploaded and the final list is added.</p>
          <div className="mt-4 space-y-1 text-left text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Container</span> <b>{selected.tRef}</b>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Container No.</span> <b>{selected.containerNumber || "—"}</b>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Total Photos</span> <b>{loadingPhotos.length}</b>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Final List</span> <b>{finalList ? "Yes" : "No"}</b>
            </p>
          </div>
          {finishMissing && finishMissing.length > 0 && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-left text-xs text-destructive">
              <b className="block">Missing before you can finish:</b>
              <ul className="list-inside list-disc">
                {finishMissing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <Button size="lg" className="mt-4 w-full bg-success text-success-foreground hover:bg-success/90" onClick={tryFinish}>
            <Check className="size-4" /> Mark Loading Finished
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setScreen("detail")}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  // --- SUCCESS ---------------------------------------------------
  return (
    <div className="mx-auto max-w-sm space-y-4 text-center">
      <div className="rounded-lg border border-border bg-card p-6">
        <PartyPopper className="mx-auto size-12 text-accent-gold" />
        <h2 className="mt-3 text-lg font-semibold">
          Container {selected.tRef} <br /> Marked as Finished
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">This container is now moved to Ready for Invoice.</p>
        <Button className="mt-4 w-full" onClick={() => setScreen("detail")}>
          View Container
        </Button>
        <Button variant="outline" className="mt-2 w-full" onClick={() => setScreen("home")}>
          Back to Home
        </Button>
      </div>
    </div>
  );
}
