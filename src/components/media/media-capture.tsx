"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, CircleCheckBig, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { uploadMediaFile } from "@/lib/media/client-upload";

/**
 * Reusable photo capture for every employee workflow. One slot is one photo.
 * Flow: camera or file → preview → upload (progress) → done. Failures keep the local preview and
 * offer Retry, which reuses the same request id, so a retry never creates a second record.
 * Retake starts a new request id and a new photo.
 *
 * Photos are evidence only. Nothing here runs AI, OCR or image analysis.
 */
type Phase = "empty" | "selected" | "uploading" | "done" | "error";

export function MediaCapture({
  label,
  ownerType,
  ownerId,
  role,
  disabled = false,
  onUploaded,
}: {
  label: string;
  ownerType: string;
  ownerId: string;
  role: string;
  disabled?: boolean;
  onUploaded?: (mediaId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("empty");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs must be released, or long shifts leak memory on phones.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function choose(next: File | undefined) {
    if (!next) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    requestIdRef.current = crypto.randomUUID();
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setError(null);
    setProgress(0);
    setPhase("selected");
  }

  async function upload() {
    if (!file) return;
    setPhase("uploading");
    setError(null);
    setProgress(0);
    try {
      const { mediaId } = await uploadMediaFile({
        ownerType,
        ownerId,
        role,
        file,
        clientRequestId: requestIdRef.current,
        onProgress: setProgress,
      });
      setProgress(100);
      setPhase("done");
      onUploaded?.(mediaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The photo could not be uploaded. Retry.");
      setPhase("error");
    }
  }

  function retake() {
    setFile(null);
    setPhase("empty");
    setError(null);
    setProgress(0);
    requestIdRef.current = crypto.randomUUID();
    inputRef.current?.click();
  }

  function remove() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setPhase("empty");
    setError(null);
    setProgress(0);
  }

  const capture = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      disabled={disabled}
      onChange={(e) => {
        choose(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  if (phase === "empty") {
    return (
      <label
        className={`flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-3 py-4 text-center text-muted-foreground active:bg-muted ${
          disabled ? "pointer-events-none opacity-50" : "hover:border-primary/40"
        }`}
      >
        {capture}
        <Camera className="size-8" aria-hidden />
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs">Tap to take a photo</span>
      </label>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-2">
      {capture}
      <div className="relative overflow-hidden rounded-lg bg-muted">
        {previewUrl && (
          // Local preview only. The uploaded image is shown from a signed URL on detail screens.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${label} preview`} className="aspect-video w-full object-cover" />
        )}
        {phase === "done" && (
          <span className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-success text-success-foreground">
            <CircleCheckBig className="size-5" aria-hidden />
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">
          {phase === "selected" && "Ready to upload"}
          {phase === "uploading" && `Uploading ${progress}%`}
          {phase === "done" && "Saved"}
          {phase === "error" && "Not saved"}
        </span>
      </div>

      {phase === "uploading" && (
        <Progress value={progress} aria-label={`${label} upload progress`}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      )}

      {phase === "error" && error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {phase === "selected" && (
          <Button className="col-span-2 h-12 text-base" onClick={upload} disabled={disabled}>
            <Upload className="size-5" /> Upload photo
          </Button>
        )}
        {phase === "error" && (
          <Button className="col-span-2 h-12 text-base" onClick={upload} disabled={disabled}>
            <RefreshCw className="size-5" /> Retry upload
          </Button>
        )}
        {(phase === "selected" || phase === "error" || phase === "done") && (
          <Button variant="outline" className="h-12" onClick={retake} disabled={disabled}>
            <Camera className="size-5" /> Retake
          </Button>
        )}
        {(phase === "selected" || phase === "error") && (
          <Button variant="outline" className="h-12" onClick={remove} disabled={disabled}>
            <Trash2 className="size-5" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
