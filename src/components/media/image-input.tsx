"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImageUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * One image chosen by a person, from the camera or from the device. "Take photo" opens the device camera where the
 * browser supports capture, and "Choose from device" opens the gallery or files. Both give a real File. The parent
 * decides what "Use photo" does. Nothing is saved here, and no camera hardware is assumed: both paths are always shown.
 */
export function ImageInput({
  label,
  onChange,
  onUse,
  useLabel = "Use photo",
  disabled = false,
}: {
  label: string;
  onChange?: (file: File | null) => void;
  onUse?: (file: File) => void;
  useLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Release the last object URL on unmount. Object URLs are created in the change handler, not in an effect.
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  function choose(next: File | undefined) {
    if (!next) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(next);
    urlRef.current = url;
    setFile(next);
    setPreview(url);
    onChange?.(next);
  }

  function retake() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setFile(null);
    setPreview(null);
    onChange?.(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {preview ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Selected photo preview" className="max-h-64 w-full rounded-md border border-border object-contain bg-muted/30" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={retake} disabled={disabled}>
              <RefreshCw /> Retake
            </Button>
            {onUse && (
              <Button type="button" className="min-h-11" onClick={() => file && onUse(file)} disabled={disabled}>
                {useLabel}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" className="min-h-11" onClick={() => cameraRef.current?.click()} disabled={disabled}>
            <Camera /> Take photo
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => deviceRef.current?.click()} disabled={disabled}>
            <ImageUp /> Choose from device
          </Button>
        </div>
      )}
      <input
        id={`${id}-camera`}
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label}: take photo`}
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <input
        id={`${id}-device`}
        ref={deviceRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label}: choose from device`}
        onChange={(e) => choose(e.target.files?.[0])}
      />
    </div>
  );
}
