"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PhotoVariant = "thumbnail" | "medium";

/**
 * A short-lived signed read URL for one saved photo. The server decides access (media RLS) and the bucket stays private.
 * Signed URLs expire after 300 s, so the cached URL is kept for 240 s. A card that stays open refetches after that.
 */
export function useSignedPhotoUrl(mediaId: string | null | undefined, variant: PhotoVariant = "medium") {
  return useQuery({
    queryKey: ["media", "photo", mediaId ?? "", variant],
    enabled: !!mediaId,
    staleTime: 240_000,
    queryFn: async () => {
      const res = await fetch(`/api/media/url?mediaId=${mediaId}&variant=${variant}`);
      if (!res.ok) throw new Error("This photo could not be opened.");
      return ((await res.json()) as { url: string }).url;
    },
  });
}

/**
 * One saved photo. Shows the real image, or an explicit loading, failed or retry state. The first image error refetches a
 * fresh signed URL once (an expired link is the usual cause). A second failure shows Retry, never a silent placeholder.
 */
export function SignedPhoto({
  mediaId,
  variant = "thumbnail",
  alt,
  className = "",
}: {
  mediaId: string;
  variant?: PhotoVariant;
  alt: string;
  className?: string;
}) {
  const query = useSignedPhotoUrl(mediaId, variant);
  const [imgFailed, setImgFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  if (query.isError || imgFailed) {
    return (
      <button
        type="button"
        className={`flex size-full flex-col items-center justify-center gap-1 bg-muted p-1 text-center text-[11px] text-destructive ${className}`}
        onClick={() => {
          setImgFailed(false);
          setRetried(true);
          query.refetch();
        }}
      >
        Photo not loaded
        <span className="font-semibold underline">Retry</span>
      </button>
    );
  }
  if (!query.data) {
    return <div className={`flex size-full items-center justify-center bg-muted text-[11px] text-muted-foreground ${className}`}>Loading photo…</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={query.data}
      alt={alt}
      className={`size-full object-cover ${className}`}
      onError={() => {
        if (!retried) {
          setRetried(true);
          query.refetch();
          setImgFailed(false);
        } else {
          setImgFailed(true);
        }
      }}
      onLoad={() => setRetried(false)}
    />
  );
}

/**
 * Every saved photo of one part, as thumbnails. Clicking one opens the medium-size preview. Nothing is hidden behind a count.
 */
export function PhotoStrip({ mediaIds, label, thumbClassName = "size-20" }: { mediaIds: string[]; label: string; thumbClassName?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (mediaIds.length === 0) {
    return <div className={`flex ${thumbClassName} items-center justify-center rounded-lg bg-muted text-[11px] text-muted-foreground`}>No photo</div>;
  }
  return (
    <>
      <ul className="flex min-w-0 flex-wrap gap-2" aria-label={`${label} photos`}>
        {mediaIds.map((id, idx) => (
          <li key={id} className={`${thumbClassName} shrink-0 overflow-hidden rounded-lg bg-muted`}>
            <button type="button" className="size-full" onClick={() => setOpen(id)} aria-label={`Open ${label} photo ${idx + 1}`}>
              <SignedPhoto mediaId={id} variant="thumbnail" alt={`${label} photo ${idx + 1}`} />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
            </DialogHeader>
            <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
              <SignedPhoto mediaId={open} variant="medium" alt={`${label} enlarged`} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
