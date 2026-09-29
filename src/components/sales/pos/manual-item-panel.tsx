"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Camera, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ManualItemPanel({ onAdd }: { onAdd: (input: { description: string; price: number; quantity: number; photoName?: string }) => void }) {
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [photoName, setPhotoName] = useState("");

  function add() {
    const priceNum = Number(price);
    const qtyNum = Number(quantity);
    if (!description.trim() || !Number.isFinite(priceNum) || priceNum < 0 || !Number.isInteger(qtyNum) || qtyNum < 1) {
      toast.error("Enter a description, valid price and quantity.");
      return;
    }
    onAdd({ description: description.trim(), price: priceNum, quantity: qtyNum, photoName: photoName || undefined });
    setDescription("");
    setPrice("");
    setQuantity("1");
    setPhotoName("");
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Manual Item</h3>
      <div className="space-y-2.5">
        <div className="space-y-1">
          <Label className="text-xs">Description</Label>
          <Input className="h-8 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Price ($)</Label>
            <Input className="h-8 text-sm" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Quantity</Label>
            <Input className="h-8 text-sm" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-1.5">
          <label className="flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary">
            <Camera className="size-3.5" /> Take Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")} />
          </label>
          <label className="flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] font-semibold text-primary">
            <Upload className="size-3.5" /> Upload
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")} />
          </label>
        </div>
        {photoName && <p className="text-xs text-muted-foreground">{photoName}</p>}
        <Button size="sm" className="w-full" onClick={add}>
          <Plus className="size-3.5" /> Add to Sale
        </Button>
        <p className="text-[11px] text-muted-foreground">Manual items are marked separately from inventory-linked items.</p>
      </div>
    </div>
  );
}
