"use client";

import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import type { DriverState, ManagerLoadState, PaymentStatus } from "@/lib/data/scrap";

/** Display formatting only. Amounts and totals arrive from the server; nothing here calculates money. */
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const LBS = new Intl.NumberFormat("en-US");
export const usd = (n: number | null | undefined) => (n == null ? "—" : USD.format(n));
export const lbs = (n: number | null | undefined) => (n == null ? "—" : `${LBS.format(n)} lb`);

/** The yard's business day (America/New_York), YYYY-MM-DD. The server uses the same zone for load dates. */
const YARD_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const yardDay = (daysAgo = 0) => YARD_DAY.format(new Date(Date.now() - daysAgo * 86400000));

export const timeLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
export const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const driverStateLabel: Record<DriverState, string> = {
  saved: "Load Photo Saved",
  awaiting_ticket: "Delivered · Ticket Needed",
  ticket_attached: "Ticket Saved · Ready to Complete",
  complete: "Complete",
};

export const managerStateLabel: Record<ManagerLoadState, string> = {
  in_progress: "In Progress",
  awaiting_ticket: "Awaiting Ticket",
  ticket_missing: "Ticket Missing",
  ready_to_complete: "Ready to Complete",
  new: "New",
  ready_for_review: "Needs Review",
  approved: "Approved",
  closed: "Closed",
};

export const paymentStatusLabelText: Record<PaymentStatus, string> = {
  not_due: "Not Due",
  payment_pending: "Payment Pending",
  mismatch: "Mismatch",
  paid: "Paid",
};

export const METHOD_OPTIONS = ["Check", "ACH", "Wire", "Other"] as const;

/** A single signed photo for detail views (medium size). Signed URLs expire, so the cache is short. */
export function usePhotoUrl(mediaId: string | null, variant: "thumbnail" | "medium" | "original" = "medium") {
  return useQuery({
    queryKey: ["scrap", "photo", mediaId, variant],
    enabled: !!mediaId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/media/url?mediaId=${mediaId}&variant=${variant}`);
      if (!res.ok) throw new Error("This photo could not be opened.");
      return ((await res.json()) as { url: string }).url;
    },
  });
}

/** Photo tile: a real image when one is available, otherwise a neutral placeholder. */
export function PhotoTile({ url, size = "size-14", label }: { url: string | null | undefined; size?: string; label: string }) {
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed private URL from the media API
        <img src={url} alt={label} loading="lazy" className="size-full object-cover" />
      ) : (
        <Camera className="size-5" aria-label={`No ${label.toLowerCase()}`} />
      )}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold">{children}</h3>;
}
