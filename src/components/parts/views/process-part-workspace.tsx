"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Barcode,
  Camera,
  ChevronLeft,
  ClipboardList,
  History as HistoryIcon,
  MapPin,
  PackageCheck,
  Printer,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { usePartsData } from "@/components/parts/parts-data-context";
import { useSession } from "@/lib/session";
import {
  partStageLabels,
  testStatusOptions,
  partConditionOptions,
  saleChannelOptions,
  notSellableReasons,
  type PartRecord,
} from "@/lib/mock/parts";

function donorRows(part: PartRecord): { label: string; value: string }[] {
  if (part.donor) {
    return [
      { label: "Year / Make / Model", value: `${part.donor.year} ${part.donor.make} ${part.donor.model}`.trim() || "—" },
      { label: "VIN", value: part.donor.vin || "—" },
      { label: "Stock / Lot #", value: part.donor.stockNumber || "—" },
      { label: "Engine", value: part.donor.engine || "—" },
      { label: "Vehicle / Yard Location", value: part.donor.yardLocation || "—" },
      { label: "Dismantling Employee", value: part.donor.employeeName || "—" },
    ];
  }
  return [
    { label: "Source VIN", value: part.draft.sourceVin || "—" },
    { label: "Source Lot #", value: part.draft.sourceLot || "—" },
    { label: "Captured by", value: part.capturedByName || "—" },
  ];
}

export function ProcessPartWorkspace({
  partId,
  manager,
  onBack,
}: {
  partId: string;
  manager: boolean;
  onBack: () => void;
}) {
  const { user } = useSession();
  const { getPart, patchPart, completeProcessing, setNotSellable, addProcessingPhoto } = usePartsData();
  const part = getPart(partId);

  const [tab, setTab] = useState("details");
  const [partName, setPartName] = useState(part?.draft.partName ?? "");
  const [category, setCategory] = useState(part?.draft.category ?? "");
  const [interchange, setInterchange] = useState(part?.draft.partNumber ?? "");
  const [partNotes, setPartNotes] = useState(part?.partNotes ?? "");
  const [condition, setCondition] = useState(part?.draft.condition ?? "");
  const [testStatus, setTestStatus] = useState(part?.testStatus ?? "Not Tested");
  const [testNotes, setTestNotes] = useState(part?.testNotes ?? "");
  const [zone, setZone] = useState(part?.zone ?? "");
  const [rack, setRack] = useState(part?.rack ?? "");
  const [shelf, setShelf] = useState(part?.shelf ?? "");
  const [bin, setBin] = useState(part?.bin ?? "");
  const [price, setPrice] = useState(part?.draft.price ?? "");
  const [coreCharge, setCoreCharge] = useState(part?.coreCharge ?? "");
  const [hasCoreCharge, setHasCoreCharge] = useState(!!part?.hasCoreCharge);
  const [channels, setChannels] = useState<string[]>(part?.saleChannels ?? ["In-Store"]);
  const [notSellableOpen, setNotSellableOpen] = useState(false);
  const [reason, setReason] = useState<string>(notSellableReasons[0]);
  const [reasonNotes, setReasonNotes] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);

  if (!part) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        This part record is no longer available.
      </div>
    );
  }

  const unverified = new Set(part.draft.needsReview ?? []);
  const locked = part.stage === "not_sellable";

  function commit(summary: string, extra?: Partial<PartRecord>) {
    patchPart(
      part!.id,
      {
        draft: { ...part!.draft, partName, category, partNumber: interchange, condition, price },
        partNotes,
        testStatus,
        testNotes,
        zone,
        rack,
        shelf,
        bin,
        coreCharge,
        hasCoreCharge,
        saleChannels: channels,
        ...extra,
      },
      user.name,
      "SAVE_PROGRESS",
      summary
    );
  }

  function saveProgress() {
    commit("Processing progress saved");
    toast.success("Progress saved");
  }

  function tryComplete() {
    const missing: string[] = [];
    if (!condition) missing.push("Condition");
    if (!testStatus || testStatus === "Not Tested") missing.push("Test status");
    if (!zone) missing.push("Warehouse zone");
    if (!price || Number(price) <= 0) missing.push("Price");
    if (missing.length) {
      toast.error("Complete Processing needs: " + missing.join(", "));
      return;
    }
    commit("Processing completed — ready for sale");
    completeProcessing(part!.id, user.name);
    toast.success(`${part!.partCode} moved to Ready for Sale`);
    onBack();
  }

  function moveToInProcessing() {
    commit("Started processing", { stage: "in_processing" });
    toast.success("Moved to In Processing");
  }

  function confirmNotSellable() {
    setNotSellable(part!.id, reason, reasonNotes, user.name);
    toast.success("Removed from sellable inventory");
    setNotSellableOpen(false);
  }

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    addProcessingPhoto(part!.id, url, user.name);
    e.target.value = "";
  }

  function toggleChannel(c: string) {
    setChannels((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  }

  const barcodeBars = (part.stockSku || part.partCode).split("").map((ch) => (ch.charCodeAt(0) % 3) + 1);

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <button onClick={onBack} className="mb-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline lg:hidden">
            <ChevronLeft className="size-3.5" /> Back to queue
          </button>
          <h3 className="truncate text-base font-semibold">Process Part: {part.partCode}</h3>
          <p className="truncate text-xs text-muted-foreground">{part.draft.partName || "Unidentified part"}</p>
        </div>
        <StatusBadge tone={part.operationalStatus === "SOLD" ? "neutral" : part.stage === "ready_for_sale" ? "success" : part.stage === "not_sellable" ? "danger" : part.stage === "in_processing" ? "info" : "warning"}>
          {part.operationalStatus === "SOLD" ? "Sold" : partStageLabels[part.stage]}
        </StatusBadge>
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(String(v))} className="flex-1 gap-0 px-4 pt-3">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">Part Details</TabsTrigger>
          <TabsTrigger value="photos">Photos ({part.photos.length})</TabsTrigger>
          <TabsTrigger value="condition">Condition &amp; Test</TabsTrigger>
          <TabsTrigger value="location">Location &amp; Pricing</TabsTrigger>
          <TabsTrigger value="barcode">Barcode &amp; Label</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4 py-4">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <ClipboardList className="size-3.5" /> Vehicle information (read-only)
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {donorRows(part).map((r) => (
                <div key={r.label} className="text-sm">
                  <span className="text-xs text-muted-foreground">{r.label}</span>
                  <p className="font-medium">{r.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Part name
                {unverified.has("partName") && <em className="text-[10px] font-semibold text-warning-foreground not-italic">AI SUGGESTED</em>}
              </Label>
              <Input disabled={!manager || locked} value={partName} onChange={(e) => setPartName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Part category</Label>
              <Input disabled={!manager || locked} value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                Interchange / OEM #
                {unverified.has("partNumber") && <em className="text-[10px] font-semibold text-warning-foreground not-italic">AI SUGGESTED · UNVERIFIED</em>}
              </Label>
              <Input disabled={!manager || locked} value={interchange} onChange={(e) => setInterchange(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Part notes</Label>
              <Textarea disabled={!manager || locked} rows={3} value={partNotes} onChange={(e) => setPartNotes(e.target.value)} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="photos" className="space-y-3 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {part.photos.map((p, i) => (
              <figure key={p.id} className="overflow-hidden rounded-md border border-border">
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted text-muted-foreground">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.type} className="size-full object-cover" />
                  ) : (
                    <Camera className="size-6" />
                  )}
                </div>
                <figcaption className="bg-muted/50 px-2 py-1 text-[10px] font-medium capitalize">
                  {i === part.photos.length - 1 ? "Main photo" : p.type}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{part.photos.length} photo(s) linked. Original dismantling/capture evidence is preserved.</p>
          {manager && !locked && (
            <div className="flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                <Camera className="size-4" /> Replace Main Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
                <Camera className="size-4" /> Add Photos
                <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
              </label>
            </div>
          )}
        </TabsContent>

        <TabsContent value="condition" className="space-y-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Condition <span className="text-destructive">*</span>
              </Label>
              <Select value={condition || undefined} onValueChange={(v) => setCondition(v ?? "")} disabled={!manager || locked}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  {partConditionOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Test status <span className="text-destructive">*</span>
              </Label>
              <Select value={testStatus} onValueChange={(v) => setTestStatus((v as typeof testStatus) ?? "Not Tested")} disabled={!manager || locked}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {testStatusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Test notes</Label>
              <Textarea disabled={!manager || locked} rows={3} value={testNotes} onChange={(e) => setTestNotes(e.target.value)} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="location" className="space-y-5 py-4">
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <MapPin className="size-3.5" /> Warehouse location
            </h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["zone", zone, setZone], ["rack", rack, setRack], ["shelf", shelf, setShelf], ["bin", bin, setBin]] as const).map(
                ([name, value, setter]) => (
                  <div key={name} className="space-y-1.5">
                    <Label className="text-xs uppercase">{name}</Label>
                    <Input disabled={!manager || locked} value={value} onChange={(e) => setter(e.target.value)} />
                  </div>
                )
              )}
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pricing</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>
                  Price <span className="text-destructive">*</span>
                </Label>
                <Input disabled={!manager || locked} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Core charge</Label>
                <Input disabled={!manager || locked || !hasCoreCharge} type="number" min={0} value={coreCharge} onChange={(e) => setCoreCharge(e.target.value)} />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Checkbox checked={hasCoreCharge} onCheckedChange={(v) => setHasCoreCharge(!!v)} disabled={!manager || locked} id="hasCore" />
                <Label htmlFor="hasCore" className="font-normal">
                  Has core charge
                </Label>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label>Sale channels</Label>
              <div className="flex flex-wrap gap-4">
                {saleChannelOptions.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={channels.includes(c)} onCheckedChange={() => toggleChannel(c)} disabled={!manager || locked} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="barcode" className="space-y-4 py-4">
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Barcode className="size-3.5" /> SKU / Part code
            </p>
            <p className="font-mono text-lg font-semibold">{part.stockSku || part.partCode}</p>
            <div className="mt-3 flex h-14 items-end gap-[2px]" aria-hidden>
              {barcodeBars.map((w, i) => (
                <span key={i} style={{ width: `${w * 2}px` }} className="h-full bg-foreground" />
              ))}
            </div>
            <p className="mt-2 font-mono text-xs tracking-widest">{part.stockSku || part.partCode}</p>
          </div>
          <Button variant="outline" onClick={() => setLabelOpen(true)}>
            <Printer className="size-4" /> Print Label
          </Button>
          <p className="text-xs text-muted-foreground">Browser print preview only — no production label printer is connected yet.</p>
        </TabsContent>

        <TabsContent value="history" className="space-y-3 py-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <HistoryIcon className="size-3.5" /> Activity
          </h4>
          <div className="space-y-2">
            {part.logs.map((log, i) => (
              <div key={i} className="rounded-md border border-border bg-background p-2.5 text-sm">
                <b>{log.action.replaceAll("_", " ")}</b>
                <span className="ml-2 text-xs text-muted-foreground">{log.userName} · {new Date(log.createdAt).toLocaleString()}</span>
                <p className="text-xs text-muted-foreground">{log.summary}</p>
              </div>
            ))}
            {!part.logs.length && <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {part.notSellable && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>Not sellable — {part.notSellable.reason}</b>
            {part.notSellable.notes && <p className="text-xs">{part.notSellable.notes}</p>}
            <p className="text-xs text-muted-foreground">
              Marked by {part.notSellable.markedBy} · {new Date(part.notSellable.markedAt).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {manager && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setNotSellableOpen(true)}>
            <AlertTriangle className="size-4" /> Remove from Sellable Inventory
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBack}>
              Cancel
            </Button>
            <Button variant="outline" onClick={saveProgress} disabled={locked}>
              Save Progress
            </Button>
            {part.stage === "needs_processing" && (
              <Button variant="outline" onClick={moveToInProcessing}>
                Start Processing
              </Button>
            )}
            <Button onClick={tryComplete} disabled={locked}>
              <PackageCheck className="size-4" /> Complete Processing
            </Button>
          </div>
        </div>
      )}

      <Dialog open={notSellableOpen} onOpenChange={setNotSellableOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from Sellable Inventory</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v ?? notSellableReasons[0])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {notSellableReasons.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={3} value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">This keeps the part record and its full history — it will no longer appear as sellable.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotSellableOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmNotSellable}>
              Mark as Not Sellable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Label preview</DialogTitle>
          </DialogHeader>
          <div id="part-label-print" className="rounded-md border border-border p-4 text-center">
            <p className="text-xs font-semibold">LAL MOTORS</p>
            <p className="mt-1 text-sm font-semibold">{part.draft.partName || "Part"}</p>
            <div className="mx-auto mt-2 flex h-12 w-fit items-end gap-[2px]">
              {barcodeBars.map((w, i) => (
                <span key={i} style={{ width: `${w * 2}px` }} className="h-full bg-foreground" />
              ))}
            </div>
            <p className="mt-1 font-mono text-xs tracking-widest">{part.stockSku || part.partCode}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelOpen(false)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
