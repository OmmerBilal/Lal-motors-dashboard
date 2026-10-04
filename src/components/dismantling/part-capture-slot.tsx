"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MediaCapture } from "@/components/media/media-capture";
import { abandonDismantledPart, beginDismantledPart } from "@/lib/data/dismantling";

/**
 * One part capture. The part row is created FIRST (server-side, idempotent on requestId), because
 * the media gate needs the owner row to exist before the photo can be attached. Then the shared
 * MediaCapture uploads the photo against that part. Discarding is allowed only before a photo is saved.
 */
export function PartCaptureSlot({
  sessionId,
  label,
  onSaved,
  onDiscard,
}: {
  sessionId: string;
  label: string;
  onSaved: (partId: string) => void;
  onDiscard: () => void;
}) {
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const startedRef = useRef(false);
  const [partId, setPartId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    beginDismantledPart(sessionId, requestIdRef.current)
      .then((id) => setPartId(id))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start this capture."));
  }, [sessionId]);

  async function discard() {
    if (!partId) return onDiscard();
    setBusy(true);
    try {
      await abandonDismantledPart(partId);
      onDiscard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "This capture already has a photo and cannot be discarded.");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" className="h-11 w-full" onClick={onDiscard}>
          Close
        </Button>
      </div>
    );
  }
  if (!partId) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Starting capture…</p>;
  }
  return (
    <div className="space-y-2">
      <MediaCapture label={label} ownerType="part" ownerId={partId} role="capture" disabled={busy} onUploaded={() => onSaved(partId)} />
      <Button variant="ghost" className="h-11 w-full text-muted-foreground" onClick={discard} disabled={busy}>
        Discard this capture
      </Button>
    </div>
  );
}
