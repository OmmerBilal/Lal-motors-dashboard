"use client";

import { useRef, useState } from "react";
import { Camera, Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared take-photo -> preview -> save/retake flow used by every evidence-capture step in the
 * Container Loading employee app (container number photo, loading photos, final loading list). */
export function PhotoCapture({
  title,
  subtitle,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string;
  subtitle: string;
  saveLabel: string;
  onSave: (previewUrl: string) => void;
  onCancel?: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file?: File) {
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
  }

  if (previewUrl) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Preview Photo</h3>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Captured preview" className="aspect-[4/3] w-full rounded-md object-cover" />
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onSave(previewUrl)}>
            <Check className="size-4" /> {saveLabel}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setPreviewUrl(null)}>
            <RotateCcw className="size-4" /> Retake Photo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {onCancel && (
          <button onClick={onCancel} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 text-primary transition-colors hover:bg-primary/10"
      >
        <Camera className="size-10" />
        <span className="text-sm font-semibold">{subtitle}</span>
        <span className="text-xs text-muted-foreground">Tap to use your camera or choose a photo</span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
