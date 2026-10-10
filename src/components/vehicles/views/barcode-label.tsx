"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import type { VehicleRecord } from "@/lib/mock/vehicles";

/** Renders the vehicle's barcode as a live Code128 SVG. Nothing here decides the barcode value — it only draws
 * whatever string the server assigned (vehicle.barcode, from vehicle_get). */
export function Code128({ value, height = 70 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    JsBarcode(ref.current, value, { format: "CODE128", displayValue: true, fontSize: 16, height, margin: 8 });
  }, [value, height]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />;
}

/** Printed under <body> via the app's existing #print-root/.print-area mechanism (see globals.css and
 * sales/pos/print/print-document.tsx) — on screen it is invisible; printing hides everything else. */
function PrintRoot({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div id="print-root" className="print-area">
      {children}
    </div>,
    document.body
  );
}

/** One self-contained vehicle barcode label: identity text + the Code128 barcode, sized for a small adhesive
 * label but equally fine on a full printed page. */
export function BarcodeLabelPrint({ vehicle }: { vehicle: VehicleRecord }) {
  return (
    <PrintRoot>
      <div className="mx-auto flex max-w-xs flex-col items-center gap-2 p-6 text-center text-black">
        <p className="text-sm font-bold">
          {vehicle.year} {vehicle.make} {vehicle.model}
        </p>
        <p className="text-xs">VIN {vehicle.vin || "—"}</p>
        <p className="text-xs">Stock # {vehicle.stockNumber || "—"}</p>
        <Code128 value={vehicle.barcode} />
      </div>
    </PrintRoot>
  );
}
