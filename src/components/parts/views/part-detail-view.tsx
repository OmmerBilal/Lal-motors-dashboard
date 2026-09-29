"use client";

import { useState } from "react";
import { Camera, ChevronLeft, MapPin, PackageCheck, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usePartsData } from "@/components/parts/parts-data-context";
import {
  generateAiDraft,
  operationalStatusOptions,
  partFieldLabels,
  partFieldOrder,
  type PartDraft,
} from "@/lib/mock/parts";
import { useSession } from "@/lib/session";

const photoCaption: Record<string, string> = {
  capture: "Warehouse part",
  source: "VIN / Lot evidence",
  final: "Final cleaned photo",
};

export function PartDetailView({
  partId,
  manager,
  origin,
  onBack,
}: {
  partId: string;
  manager: boolean;
  origin: "pending" | "inventory";
  onBack: () => void;
}) {
  const { user } = useSession();
  const { getPart, setDraft, setStatus, approve, saveOperations, addFinalPhoto } = usePartsData();
  const part = getPart(partId);
  const [command, setCommand] = useState("Process this part.");
  const [busy, setBusy] = useState(false);
  const [localDraft, setLocalDraft] = useState<PartDraft>(part?.draft ?? {});
  const [opForm, setOpForm] = useState({
    zone: part?.zone ?? "",
    rack: part?.rack ?? "",
    shelf: part?.shelf ?? "",
    bin: part?.bin ?? "",
    operationalStatus: part?.operationalStatus ?? "AVAILABLE",
    quantity: part?.quantity ?? 1,
    note: "",
  });

  if (!part) return null;

  const approved = part.status === "approved";
  const reviewing = part.status === "manager_review";
  const draftReady = part.status === "draft_ready";
  const editable = approved || reviewing;

  function processPart() {
    setBusy(true);
    window.setTimeout(() => {
      const draft = generateAiDraft();
      setDraft(part!.id, draft);
      setLocalDraft(draft);
      setStatus(part!.id, "draft_ready", user.name, "AI draft generated from evidence");
      setBusy(false);
      toast.success("AI draft ready for manager review");
    }, 400);
  }

  function startReview() {
    setStatus(part!.id, "manager_review", user.name, "Manager review started");
    toast.success("Manager review started");
  }

  function saveRecord(action: "approve" | "edit") {
    if (action === "approve") {
      const sku = approve(part!.id, localDraft, user.name);
      toast.success(`Part added to inventory · ${sku}`);
    } else {
      setDraft(part!.id, localDraft);
      toast.success("Part record updated");
    }
    onBack();
  }

  function saveOps() {
    saveOperations(part!.id, opForm, user.name);
    toast.success("Location, status and quantity updated");
  }

  return (
    <section className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" /> Back to {origin === "inventory" ? "parts inventory" : "pending queue"}
      </button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {approved ? "Permanent part details" : "Office manager review"}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{approved ? part.draft.title || part.draft.partName : "Pending Part"}</h2>
          <p className="text-sm text-muted-foreground">
            ID {part.id} · Captured by {part.capturedByName} · {new Date(part.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge>{`${part.photos.length} linked photos · ${part.status.replaceAll("_", " ")}`}</StatusBadge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Permanent source evidence</h3>
          <div className="grid grid-cols-2 gap-3">
            {part.photos.map((p) => (
              <figure key={p.id} className="overflow-hidden rounded-md border border-border">
                <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
                  <Camera className="size-6" />
                </div>
                <figcaption className="bg-muted/50 px-2 py-1 text-[11px] font-medium">{photoCaption[p.type]}</figcaption>
              </figure>
            ))}
          </div>
          {manager && (
            <div className="mt-4 flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                <Camera className="size-4" /> Take final cleaned photos
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={() => addFinalPhoto(part!.id)} />
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
                <Upload className="size-4" /> Choose final photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={() => addFinalPhoto(part!.id)} />
              </label>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-start gap-2.5">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">{approved ? "Part Details" : "LAL Parts AI Manager"}</h3>
              <p className="text-xs text-muted-foreground">
                {approved ? "View and update this same permanent record." : "The selected record and all linked evidence are sent automatically."}
              </p>
            </div>
          </div>

          {!approved && !draftReady && !reviewing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Manager command</Label>
                <Input value={command} onChange={(e) => setCommand(e.target.value)} />
              </div>
              <Button className="w-full" disabled={busy || command.trim() !== "Process this part."} onClick={processPart}>
                {busy ? "AI processing exact record…" : "Process this part"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs font-semibold text-warning-foreground">
                {localDraft.fitmentStatus === "verified" ? "Manager marked fitment verified." : "FITMENT VERIFICATION REQUIRED — exact interchange was not guessed."}
              </div>
              {draftReady && (
                <Button className="w-full" disabled={busy} onClick={startReview}>
                  Review AI Draft
                </Button>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {partFieldOrder.map((name) => (
                  <div key={name} className={["description", "fitment"].includes(name) ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
                    <Label className="flex items-center gap-1.5">
                      {partFieldLabels[name]}
                      {localDraft.needsReview?.includes(name) && (
                        <em className="text-[10px] font-semibold text-warning-foreground not-italic">NEEDS MANAGER REVIEW</em>
                      )}
                    </Label>
                    {name === "fitmentStatus" ? (
                      <Select
                        value={localDraft.fitmentStatus || "verification_required"}
                        onValueChange={(v) =>
                          setLocalDraft({
                            ...localDraft,
                            fitmentStatus: v ?? "verification_required",
                            fitment: v === "verified" ? localDraft.fitment : "FITMENT VERIFICATION REQUIRED",
                          })
                        }
                        disabled={!editable}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="verification_required">FITMENT VERIFICATION REQUIRED</SelectItem>
                          <SelectItem value="verified">Verified by manager/source</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : name === "description" || name === "fitment" ? (
                      <Textarea
                        disabled={!editable}
                        rows={3}
                        value={localDraft[name] ?? ""}
                        onChange={(e) => setLocalDraft({ ...localDraft, [name]: e.target.value })}
                      />
                    ) : (
                      <Input
                        disabled={!editable}
                        type={name === "price" ? "number" : "text"}
                        value={localDraft[name] ?? ""}
                        onChange={(e) => setLocalDraft({ ...localDraft, [name]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
              {manager && approved && (
                <Button className="w-full" disabled={busy || !localDraft.partName || !localDraft.title} onClick={() => saveRecord("edit")}>
                  Save Changes to Same Record
                </Button>
              )}
              {manager && reviewing && (
                <Button className="w-full" disabled={busy || !localDraft.partName || !localDraft.title} onClick={() => saveRecord("approve")}>
                  <PackageCheck /> Approve to Parts Inventory
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {approved && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <MapPin className="size-5 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Parts Operations</h3>
              <p className="text-xs text-muted-foreground">
                <b>{part.stockSku || "SKU pending"}</b> · {part.operationalStatus} · Quantity {part.quantity}
              </p>
            </div>
          </div>
          <div className="mb-4 rounded-md bg-muted/40 px-3 py-2 text-sm font-medium">
            {part.draft.location || "Location not assigned"}
          </div>
          {manager && (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {(["zone", "rack", "shelf", "bin"] as const).map((name) => (
                  <div key={name} className="space-y-1.5">
                    <Label className="text-xs uppercase">{name}</Label>
                    <Input value={opForm[name]} onChange={(e) => setOpForm({ ...opForm, [name]: e.target.value })} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase">Status</Label>
                  <Select value={opForm.operationalStatus} onValueChange={(v) => setOpForm({ ...opForm, operationalStatus: v ?? "AVAILABLE" })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operationalStatusOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase">Quantity</Label>
                  <Input
                    type="number"
                    min={0}
                    value={opForm.quantity}
                    onChange={(e) => setOpForm({ ...opForm, quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-3 lg:col-span-6">
                  <Label className="text-xs uppercase">Note / reason</Label>
                  <Input value={opForm.note} onChange={(e) => setOpForm({ ...opForm, note: e.target.value })} />
                </div>
              </div>
              <Button className="mt-3" onClick={saveOps}>
                Save Operational Change
              </Button>
            </>
          )}
          <div className="mt-5">
            <h4 className="mb-2 text-sm font-semibold">Movement & operation history</h4>
            <div className="space-y-2">
              {part.history.map((h) => (
                <div key={h.id} className="rounded-md border border-border bg-background p-2.5 text-sm">
                  <b>{h.actionType.replaceAll("_", " ")}</b>
                  <span className="ml-2 text-muted-foreground">
                    {h.previousLocation || "Unassigned"} → {h.newLocation || "Unassigned"}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {h.previousStatus} → {h.newStatus} · Qty {h.previousQuantity} → {h.newQuantity}
                    <br />
                    {h.userName} · {new Date(h.createdAt).toLocaleString()}
                    {h.note ? ` · ${h.note}` : ""}
                  </div>
                </div>
              ))}
              {!part.history.length && <p className="text-sm text-muted-foreground">No operational changes yet.</p>}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Audit history</h3>
        <div className="space-y-2">
          {part.logs.map((log, i) => (
            <p key={i} className="text-sm">
              <b>{log.action}</b> · {log.userName} · {new Date(log.createdAt).toLocaleString()}
              <br />
              <small className="text-muted-foreground">{log.summary}</small>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
