"use client";

import { useState } from "react";
import { Camera, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared take-photo → preview → retake/save step used by New Load, Add Ticket and Add Check. */
export function CameraStep({
  stepLabel,
  title,
  instruction,
  tone,
  saveLabel,
  onSave,
}: {
  stepLabel?: string;
  title: string;
  instruction: string;
  tone: "success" | "info" | "brand";
  saveLabel: string;
  onSave: () => void;
}) {
  const [captured, setCaptured] = useState(false);
  const [fileName, setFileName] = useState("");

  const toneClasses: Record<typeof tone, string> = {
    success: "bg-success/10 text-success",
    info: "bg-primary/10 text-primary",
    brand: "bg-accent-gold/15 text-accent-gold-foreground",
  } as const;

  if (!captured) {
    return (
      <div className="space-y-3">
        {stepLabel && <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{stepLabel}</p>}
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center ${toneClasses[tone]}`}
        >
          <Camera className="size-10" />
          <span className="text-sm font-semibold">{title}</span>
          <span className="max-w-xs text-xs text-muted-foreground">{instruction}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFileName(f.name);
                setCaptured(true);
              }
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview Photo</p>
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
        <div className="flex flex-col items-center gap-1 px-4 text-center">
          <Camera className="size-8" />
          <span className="max-w-[18rem] truncate text-xs">{fileName}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setCaptured(false);
            setFileName("");
          }}
        >
          <RotateCcw className="size-4" /> Retake
        </Button>
        <Button
          onClick={() => {
            onSave();
            setCaptured(false);
            setFileName("");
          }}
        >
          <Check className="size-4" /> {saveLabel}
        </Button>
      </div>
    </div>
  );
}
