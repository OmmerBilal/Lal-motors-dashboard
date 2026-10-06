"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MediaCapture } from "@/components/media/media-capture";
import { createManualInventoryPart } from "@/lib/data/manual-part";
import { usd } from "@/lib/mock/sales";

/**
 * Adds a real inventory part by hand (no donor vehicle). It is sellable at once, and a quantity of 0 shows as
 * Out of Stock. The SKU is optional and is never invented here: a blank SKU stays blank.
 */
export function ManualPartDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState({ partName: "", quantity: "1", price: "", notes: "", category: "", condition: "Used", partNumber: "", location: "", stockSku: "" });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<{ partId: string; sku: string | null; quantity: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Number(form.quantity);
  const price = Number(form.price);
  const requiredOk = form.partName.trim().length >= 2 && Number.isInteger(qty) && qty >= 0 && form.price !== "" && price >= 0;

  function reset() {
    setForm({ partName: "", quantity: "1", price: "", notes: "", category: "", condition: "Used", partNumber: "", location: "", stockSku: "" });
    setRequestId(crypto.randomUUID());
    setCreated(null);
    setError(null);
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await createManualInventoryPart(
        { partName: form.partName.trim(), quantity: qty, price, category: form.category, partNumber: form.partNumber, condition: form.condition, location: form.location, notes: form.notes, stockSku: form.stockSku },
        requestId
      );
      setCreated({ partId: r.part_id, sku: r.stock_sku, quantity: r.quantity });
      toast.success("Inventory part added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The part was not added. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "Inventory part added" : "Add Inventory Part"}</DialogTitle>
        </DialogHeader>

        {!created && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Part Name <span className="text-destructive">*</span></span>
              <Input className="h-10" value={form.partName} maxLength={160} onChange={(e) => setForm({ ...form, partName: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Quantity <span className="text-destructive">*</span></span>
              <Input className="h-10 tabular-nums" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Selling Price <span className="text-destructive">*</span></span>
              <Input className="h-10 tabular-nums" inputMode="decimal" value={form.price} placeholder="0.00" onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Category</span>
              <Input className="h-10" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Condition</span>
              <Input className="h-10" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">OEM / Interchange #</span>
              <Input className="h-10" value={form.partNumber} onChange={(e) => setForm({ ...form, partNumber: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Location</span>
              <Input className="h-10" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">SKU (optional)</span>
              <Input className="h-10" value={form.stockSku} onChange={(e) => setForm({ ...form, stockSku: e.target.value })} />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Description / Notes</span>
              <Textarea value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          </div>
        )}

        {created && (
          <div className="space-y-3">
            <p className="text-sm">
              <b>{form.partName}</b> · Quantity {created.quantity} · {usd(form.price || 0)}
              {created.sku ? <span> · SKU {created.sku}</span> : null}
            </p>
            <p className="text-sm text-muted-foreground">It is sellable now. Search for it on the Sales Desk.</p>
            <div className="space-y-1">
              <p className="text-sm font-medium">Photo (optional)</p>
              <MediaCapture label="Part photo" ownerType="part" ownerId={created.partId} role="capture" />
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          {created ? (
            <Button className="h-11 w-full" onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button className="h-11 w-full" disabled={!requiredOk || saving} onClick={save}>{saving ? "Adding…" : "Add Inventory Part"}</Button>
              <Button variant="outline" className="h-11 w-full" onClick={() => close(false)}>Cancel</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
