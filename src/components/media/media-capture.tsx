"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CircleAlert, CircleCheckBig, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { uploadMediaFile } from "@/lib/media/client-upload";

/**
 * Reusable photo capture for every employee workflow. One slot is one photo.
 *
 * States, in the order a person sees them:
 *   Empty      Take Photo / Choose from Device
 *   Not saved  a local preview only. It is NOT on the server until Save Photo succeeds
 *   Uploading  disables every other action until the upload finishes
 *   Not saved  after a failed save, with Try again. The preview is kept.
 *   Saved      server-confirmed. Replace starts a new capture for this slot.
 *
 * Take Photo uses the native camera on touch devices. On a laptop or desktop it opens the live webcam
 * (getUserMedia), and the captured frame goes through the same selection and upload path as a file.
 * Photos are evidence only. Nothing here runs AI, OCR or image analysis.
 */
type Phase = "empty" | "selected" | "uploading" | "error" | "done";

/** Signed preview of a saved photo. Read through the media route, so access is decided on the server. */
export function usePersistedPhoto(mediaId: string | null | undefined) {
  return useQuery({
    queryKey: ["media", "photo", mediaId ?? "", "medium"],
    enabled: !!mediaId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/media/url?mediaId=${mediaId}&variant=medium`);
      if (!res.ok) throw new Error("This photo could not be opened.");
      return ((await res.json()) as { url: string }).url;
    },
  });
}

/** Touch devices use the native camera. A laptop or desktop with a mouse or trackpad gets the live webcam. */
function prefersNativeCamera() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export const CAMERA_UNAVAILABLE_MESSAGE = "Camera unavailable. Choose a photo from your device instead.";

function canUseWebcam() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Live webcam body. It mounts only while the dialog is open, so every open starts from a clean state. */
function CameraBody({
  label,
  onCapture,
  onClose,
  onChooseDevice,
}: {
  label: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  onChooseDevice: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "unavailable">(() => (canUseWebcam() ? "starting" : "unavailable"));

  // The stream lives only while this body is mounted. Closing the dialog stops every camera track.
  useEffect(() => {
    if (!canUseWebcam()) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => undefined);
        }
        setStatus("live");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setStatus("unavailable");
          return;
        }
        onCapture(new File([blob], `${label.replace(/\W+/g, "-").toLowerCase()}-webcam.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <>
      {status === "unavailable" ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{CAMERA_UNAVAILABLE_MESSAGE}</p>
      ) : (
        <div className="overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" aria-label={`${label} webcam preview`} />
          {status === "starting" && <p className="p-3 text-center text-sm text-muted-foreground">Starting the camera…</p>}
        </div>
      )}
      <DialogFooter className="flex flex-col gap-2 sm:flex-row">
        {status === "unavailable" ? (
          <Button className="h-11 w-full" onClick={onChooseDevice}>
            <Upload className="size-4" /> Choose from Device
          </Button>
        ) : (
          <Button className="h-11 w-full" onClick={capture} disabled={status !== "live"}>
            <Camera className="size-4" /> Capture Photo
          </Button>
        )}
        <Button variant="outline" className="h-11 w-full" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}

/** Desktop webcam dialog. A captured frame goes back through the same selection path as a chosen file. */
function WebcamDialog({
  open,
  label,
  onCapture,
  onClose,
  onChooseDevice,
}: {
  open: boolean;
  label: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  onChooseDevice: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take photo: {label}</DialogTitle>
        </DialogHeader>
        {open && <CameraBody label={label} onCapture={onCapture} onClose={onClose} onChooseDevice={onChooseDevice} />}
      </DialogContent>
    </Dialog>
  );
}

export function MediaCapture({
  label,
  ownerType,
  ownerId,
  role,
  disabled = false,
  persistedMediaId = null,
  onUploaded,
  onPendingChange,
}: {
  label: string;
  ownerType: string;
  ownerId: string;
  role: string;
  disabled?: boolean;
  /** A photo already saved for this slot (from the server). It is shown as saved until the person replaces it. */
  persistedMediaId?: string | null;
  onUploaded?: (mediaId: string) => void;
  /** True while a local photo is chosen but not yet saved. The parent shows this in the progress block. */
  onPendingChange?: (role: string, pending: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const persisted = usePersistedPhoto(persistedMediaId);
  const [phase, setPhase] = useState<Phase>("empty");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [savedHere, setSavedHere] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);

  // Object URLs must be released, or long shifts leak memory on phones.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Tell the parent when a local, unsaved photo is waiting. It is cleared on unmount, so a vehicle change never leaves a stale count.
  const pending = phase === "uploading" || (!!file && phase !== "done");
  useEffect(() => {
    onPendingChange?.(role, pending);
  }, [pending, role, onPendingChange]);
  useEffect(() => () => onPendingChange?.(role, false), [role, onPendingChange]);

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

  async function save() {
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
      // Reload this owner's saved photos before showing Saved, so the label and any gate built on the saved list change together.
      await queryClient.invalidateQueries({ queryKey: ["media", "owner", ownerType, ownerId] });
      setSavedHere(true);
      setPhase("done");
      setReplacing(false);
      onUploaded?.(mediaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The photo was not saved. Try again.");
      setPhase("error");
    }
  }

  // Retake and Choose another replace the local selection only. Nothing on the server changes until Save Photo succeeds.
  function startNewSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setError(null);
    setProgress(0);
    setPhase("empty");
  }

  function beginReplace() {
    startNewSelection();
    setReplacing(true);
  }

  function cancelSelection() {
    startNewSelection();
    setReplacing(false);
  }

  function openCamera() {
    if (prefersNativeCamera()) inputRef.current?.click();
    else setCameraOpen(true);
  }

  // Two real inputs: the camera (capture, used on touch devices) and the device gallery/files. Both feed the same selection and save path.
  const inputs = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label}: take photo`}
        disabled={disabled}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={deviceRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={`${label}: choose from device`}
        disabled={disabled}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <WebcamDialog
        open={cameraOpen}
        label={label}
        onClose={() => setCameraOpen(false)}
        onChooseDevice={() => {
          setCameraOpen(false);
          deviceRef.current?.click();
        }}
        onCapture={(captured) => {
          setCameraOpen(false);
          choose(captured);
        }}
      />
    </>
  );

  const hasSaved = !!persistedMediaId || savedHere;
  const state: "uploading" | "selected" | "error" | "chooser" | "saved" = (() => {
    if (phase === "uploading") return "uploading";
    if (file && (phase === "selected" || phase === "error")) return phase === "error" ? "error" : "selected";
    if (replacing || !hasSaved) return "chooser";
    return "saved";
  })();

  const shownImage = phase === "done" && previewUrl ? previewUrl : persisted.data ?? null;

  const pill =
    state === "saved" ? (
      <span className="flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-bold text-success-foreground">
        <CircleCheckBig className="size-3.5" aria-hidden /> Saved
      </span>
    ) : state === "uploading" ? (
      <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Uploading…
      </span>
    ) : state === "error" ? (
      <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">NOT SAVED</span>
    ) : state === "selected" ? (
      <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-bold whitespace-nowrap text-warning-foreground">NOT SAVED YET</span>
    ) : (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
        {replacing ? "Replace" : "Empty"}
      </span>
    );

  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
      data-slot-state={state}
    >
      {inputs}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 text-sm leading-tight font-semibold break-words">{label}</span>
        {pill}
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
        {state === "chooser" && !shownImage ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <Camera className="size-7" aria-hidden />
            <span className="text-xs">No photo yet</span>
          </div>
        ) : shownImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shownImage} alt={`${label} ${state === "saved" ? "saved" : "selected"} photo`} className="size-full object-cover" />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${label} selected photo`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Loading saved photo…</div>
        )}
        {state === "saved" && (
          <span className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-success text-success-foreground">
            <CircleCheckBig className="size-5" aria-hidden />
          </span>
        )}
      </div>

      {state === "selected" && (
        <p className="text-xs font-medium text-warning-foreground">
          {replacing ? "New photo selected. The saved photo stays until you save this one." : "This photo is not saved yet. Tap Save Photo."}
        </p>
      )}
      {state === "uploading" && (
        <Progress value={progress} aria-label={`${label} upload progress`}>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      )}
      {state === "error" && error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      <div className="flex flex-col gap-2">
        {state === "chooser" && (
          <>
            <Button className="h-11 w-full text-sm" onClick={openCamera} disabled={disabled}>
              <Camera className="size-4" /> Take Photo
            </Button>
            <Button variant="outline" className="h-11 w-full text-sm" onClick={() => deviceRef.current?.click()} disabled={disabled}>
              <Upload className="size-4" /> Choose from Device
            </Button>
            {replacing && (
              <Button variant="ghost" className="h-10 w-full text-sm" onClick={cancelSelection} disabled={disabled}>
                Cancel replacement
              </Button>
            )}
          </>
        )}
        {state === "selected" && (
          <>
            <Button className="h-12 w-full text-base" onClick={save} disabled={disabled}>
              <Upload className="size-5" /> Save Photo
            </Button>
            <Button variant="outline" className="h-10 w-full text-sm" onClick={openCamera} disabled={disabled}>
              <Camera className="size-4" /> Retake
            </Button>
            <Button variant="outline" className="h-10 w-full text-sm" onClick={() => deviceRef.current?.click()} disabled={disabled}>
              <Upload className="size-4" /> Choose Another
            </Button>
            {replacing && (
              <Button variant="ghost" className="h-10 w-full text-sm" onClick={cancelSelection} disabled={disabled}>
                Cancel replacement
              </Button>
            )}
          </>
        )}
        {state === "error" && (
          <>
            <Button className="h-12 w-full text-base" onClick={save} disabled={disabled}>
              <RefreshCw className="size-5" /> Try saving again
            </Button>
            <Button variant="outline" className="h-10 w-full text-sm" onClick={openCamera} disabled={disabled}>
              <Camera className="size-4" /> Retake
            </Button>
            <Button variant="outline" className="h-10 w-full text-sm" onClick={() => deviceRef.current?.click()} disabled={disabled}>
              <Upload className="size-4" /> Choose Another
            </Button>
          </>
        )}
        {state === "saved" && (
          <Button variant="outline" className="h-10 w-full text-sm" onClick={beginReplace} disabled={disabled}>
            <Camera className="size-4" /> Replace
          </Button>
        )}
        {state === "uploading" && (
          <p className="text-center text-sm font-medium text-muted-foreground">Uploading… {progress}%</p>
        )}
      </div>
    </div>
  );
}

/** Stable setter for a parent that tracks unsaved selections by slot role. Pass setSlotPending as MediaCapture's onPendingChange. */
export function usePendingSlots() {
  const [pendingBySlot, setPendingBySlot] = useState<Record<string, boolean>>({});
  const setSlotPending = useCallback((role: string, pending: boolean) => {
    setPendingBySlot((prev) => (prev[role] === pending ? prev : { ...prev, [role]: pending }));
  }, []);
  return { pendingBySlot, setSlotPending };
}
