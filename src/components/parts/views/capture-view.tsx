"use client";

import { useState } from "react";
import { Camera, CheckCircle2, FileImage } from "lucide-react";
import { toast } from "sonner";
import { usePartsData } from "@/components/parts/parts-data-context";

type Pick = { name: string } | null;

function PhotoBox({ title, value, onPick }: { title: string; value: Pick; onPick: (name: string) => void }) {
  return (
    <div
      className={`flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center ${
        value ? "border-success/50 bg-success/5" : "border-border bg-muted/20"
      }`}
    >
      {value ? <CheckCircle2 className="size-8 text-success" /> : <Camera className="size-8 text-primary" />}
      <b className="text-sm">{value ? "Photo ready" : title}</b>
      <label className="cursor-pointer rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
        {value ? "Retake" : "Open Camera"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onPick(e.target.files[0].name);
            e.target.value = "";
          }}
        />
      </label>
      <label className="cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
        Photo Library
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onPick(e.target.files[0].name);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export function CaptureView() {
  const { addCapture } = usePartsData();
  const [partPhoto, setPartPhoto] = useState<Pick>(null);
  const [sourcePhoto, setSourcePhoto] = useState<Pick>(null);
  const [saving, setSaving] = useState(false);

  function saveNext() {
    if (!partPhoto || !sourcePhoto) return toast.error("Take both required photos.");
    setSaving(true);
    window.setTimeout(() => {
      addCapture();
      setPartPhoto(null);
      setSourcePhoto(null);
      setSaving(false);
      toast.success("Pending part saved. Ready for the next part.");
    }, 300);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="text-center">
        <b className="block text-lg font-semibold">Employee: only 3 steps</b>
        <span className="text-sm text-muted-foreground">Part photo → VIN/Lot photo → Save & Next</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PhotoBox title="1. Take part photo" value={partPhoto} onPick={(n) => setPartPhoto({ name: n })} />
        <PhotoBox title="2. Take VIN or Lot photo" value={sourcePhoto} onPick={(n) => setSourcePhoto({ name: n })} />
      </div>
      <button
        disabled={saving || !partPhoto || !sourcePhoto}
        onClick={saveNext}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-success text-base font-bold text-success-foreground disabled:opacity-40"
      >
        <FileImage className="size-5" /> {saving ? "Saving linked photos…" : "Save & Next"}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        No typing. Both photos are permanently linked before the record enters the queue.
      </p>
    </div>
  );
}
