"use client";

import { MapPin, Phone } from "lucide-react";
import { useSalesSettings } from "@/lib/query/sales";

/** Slim footer. Address/phone come from the real, owner-editable business settings row (Sales → Settings) used
 * on receipts — the same source of truth, not a separate fabricated contact. There is no "WhatsApp number" field
 * anywhere in the schema, so that line is left out rather than invented. */
export function DashboardFooter() {
  const { data: settings } = useSalesSettings();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-1 py-4 text-xs text-muted-foreground">
      <p>LAL Motors — Auction, Parts &amp; Export Management</p>
      <div className="flex flex-wrap items-center gap-4">
        {settings?.businessAddress && (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5" /> {settings.businessAddress}
          </span>
        )}
        {settings?.businessPhone && (
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5" /> {settings.businessPhone}
          </span>
        )}
      </div>
    </div>
  );
}
