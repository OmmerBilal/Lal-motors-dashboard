"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Loaded only when the user actually opens the camera or picks an image — neither library is in the
// initial bundle. Both come from the same barcode engine (@zxing/browser + its required peer
// @zxing/library) so the live-camera and static-image paths share one decoder and one set of formats.
async function loadZxing() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map();
  // Code128/Code39 cover the LAL-printed label and most factory VIN plates; QR/Data Matrix are included
  // since some auctions print those instead.
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]);
  return new BrowserMultiFormatReader(hints);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be loaded."));
    img.src = src;
  });
}

/** VIN charset excludes I, O and Q — same rule used everywhere else in the app (parse-intake.ts, the barcode migration). */
const VIN_TOKEN = /[A-HJ-NPR-Z0-9]{17}/;

/**
 * Tries a barcode read first (handles the LAL- printed label and factory VIN barcodes/QR codes); if nothing
 * decodes, falls back to OCR for a bare 17-character VIN printed as plain text (e.g. a dash or door-jamb
 * sticker with no barcode). Returns null, never throws, when nothing usable was found.
 */
async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    try {
      const reader = await loadZxing();
      const img = await loadImageElement(url);
      const result = await reader.decodeFromImageElement(img);
      const text = result.getText();
      if (text) return text;
    } catch {
      // No barcode in this image — fall through to OCR below.
    }

    try {
      const Tesseract = await import("tesseract.js");
      const { data } = await Tesseract.recognize(url, "eng");
      const match = (data.text || "").toUpperCase().match(VIN_TOKEN);
      return match ? match[0] : null;
    } catch {
      return null;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CameraScanDialog({ onClose, onDecoded }: { onClose: () => void; onDecoded: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reader = await loadZxing();
        if (cancelled || !videoRef.current) return;
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result, _err, ctrl) => {
            if (cancelled || !result) return;
            ctrl.stop();
            onDecoded(result.getText());
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        stopRef.current = () => controls.stop();
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setError("Camera access was denied. Allow camera access in your browser, or use Upload image instead.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setError("No camera was found on this device. Use Upload image instead.");
        } else if (name === "NotReadableError") {
          setError("The camera is in use by another app. Use Upload image instead.");
        } else {
          setError("The camera could not be opened. Use Upload image instead.");
        }
      }
    })();
    return () => {
      cancelled = true;
      stopRef.current?.();
    };
  }, [onDecoded]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Scan a barcode or VIN">
      <div className="w-full max-w-sm overflow-hidden rounded-lg bg-background p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Scan a barcode or VIN</p>
          <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-md p-1 hover:bg-accent/40">
            <X className="size-4" />
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="aspect-video w-full rounded-md bg-black object-cover" muted autoPlay playsInline />
            <p className="mt-2 text-xs text-muted-foreground">Point the camera at the barcode or VIN plate.</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Camera + image-upload scanning, dropped next to a module's existing VIN/lot/stock text input. A successful
 * read only ever calls `onDecoded(code)` — the caller feeds that string into its own existing lookup path
 * (the same handler manual Enter already triggers), so every module keeps its own "found" behaviour and
 * server-side checks (receiving eligibility, dismantling's "assigned to you" check, etc.) unchanged. Nothing
 * here ever opens a vehicle itself.
 */
export function VehicleScanInput({ onDecoded, className }: { onDecoded: (code: string) => void; className?: string }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const code = await decodeImageFile(file);
      if (code) {
        onDecoded(code);
      } else {
        toast.error("Couldn't read a barcode or VIN from that photo — try again or type it.");
      }
    } catch {
      toast.error("Couldn't read that photo — try again or type it.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)} disabled={uploading}>
          <Camera className="size-4" /> Scan
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? "Reading…" : "Upload image"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
      {cameraOpen && (
        <CameraScanDialog
          onClose={() => setCameraOpen(false)}
          onDecoded={(code) => {
            setCameraOpen(false);
            onDecoded(code);
          }}
        />
      )}
    </div>
  );
}
