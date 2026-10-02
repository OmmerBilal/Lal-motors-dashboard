"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  parts as seedParts,
  type PartDraft,
  type PartRecord,
  type PartStatus,
  type PartStage,
  type PartDonorInfo,
} from "@/lib/mock/parts";
import { detailedCategoryLabel, suggestedOem } from "@/lib/mock/dismantling-processing";
import { useVehicleData } from "@/components/vehicles/vehicle-data-context";
import type { VehicleEvent } from "@/lib/mock/vehicles";

type ProcessingInput = {
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  operationalStatus: string;
  quantity: number;
  note: string;
};

type PartsDataValue = {
  parts: PartRecord[];
  getPart: (id: string) => PartRecord | undefined;
  addCapture: () => string;
  setDraft: (id: string, draft: PartDraft) => void;
  setStatus: (id: string, status: PartStatus, actorName: string, summary: string) => void;
  approve: (id: string, draft: PartDraft, actorName: string) => string;
  addFinalPhoto: (id: string) => void;
  saveOperations: (id: string, input: ProcessingInput, actorName: string) => void;
  /** Generic patch used by the Parts Inventory processing workspace (A5-A14). Works for
   * both manually-captured parts and dismantling-derived parts — writes land in an
   * overrides layer keyed by part id, merged on top of whichever base record produced it. */
  patchPart: (id: string, patch: Partial<PartRecord>, actorName: string, logAction: string, logSummary: string) => void;
  setStage: (id: string, stage: PartStage, actorName: string, summary: string) => void;
  completeProcessing: (id: string, actorName: string) => void;
  setNotSellable: (id: string, reason: string, notes: string, actorName: string) => void;
  addProcessingPhoto: (id: string, url: string, actorName: string) => void;
};

const PartsDataContext = createContext<PartsDataValue | null>(null);

let stockCounter = 10046;

const RESOLVED_APPROVED: VehicleEvent["action"][] = ["REVIEW_APPROVED", "REVIEW_EDITED_APPROVED"];
const RESOLVED_REJECTED: VehicleEvent["action"][] = ["REVIEW_MARKED_DUPLICATE", "REVIEW_REJECTED"];

function mergedPart(
  id: string,
  manual: PartRecord[],
  derived: PartRecord[],
  overrides: Record<string, Partial<PartRecord>>
): PartRecord | undefined {
  const base = manual.find((p) => p.id === id) ?? derived.find((p) => p.id === id);
  if (!base) return undefined;
  const patch = overrides[id];
  return patch ? { ...base, ...patch } : base;
}

export function PartsDataProvider({ children }: { children: React.ReactNode }) {
  const [manualParts, setManualParts] = useState<PartRecord[]>(seedParts);
  const [overrides, setOverrides] = useState<Record<string, Partial<PartRecord>>>({});
  const { events, vehicles } = useVehicleData();

  // --- Task A4: derive Parts Inventory records from approved Dismantling part removals,
  // instead of mutating anything in the Dismantling/Dismantling Processing modules. The
  // derived id is a stable function of the dismantling event's partId, so recomputing this
  // on every render is naturally idempotent — there's nothing to de-duplicate because the
  // same source event always yields the same derived record.
  const derivedParts = useMemo<PartRecord[]>(() => {
    const removed = events.filter((e): e is VehicleEvent & { partId: string } => e.action === "PART_REMOVED" && !!e.partId);
    const resolutionsByPartId = new Map<string, VehicleEvent["action"][]>();
    for (const e of events) {
      if (!e.partId) continue;
      if (RESOLVED_APPROVED.includes(e.action) || RESOLVED_REJECTED.includes(e.action)) {
        const list = resolutionsByPartId.get(e.partId) ?? [];
        list.push(e.action);
        resolutionsByPartId.set(e.partId, list);
      }
    }

    const qualifying = removed.filter((e) => {
      const resolutions = resolutionsByPartId.get(e.partId) ?? [];
      if (resolutions.some((a) => RESOLVED_REJECTED.includes(a))) return false;
      if (e.disposition === "IN INVENTORY") return true;
      return resolutions.some((a) => RESOLVED_APPROVED.includes(a));
    });

    // Deterministic display-code numbering: sort by partId so re-renders never reshuffle codes.
    const orderedIds = [...qualifying.map((e) => e.partId)].sort();

    return qualifying.map((event) => {
      const vehicle = vehicles.find((v) => v.id === event.vehicleId);
      const partType = event.partType || "Unidentified part";
      const codeIndex = orderedIds.indexOf(event.partId);
      const partCode = `NP-${1001 + codeIndex}`;
      const donor: PartDonorInfo = {
        vehicleId: event.vehicleId,
        vin: vehicle?.vin || "",
        stockNumber: vehicle?.stockNumber || vehicle?.lotNumber || "",
        year: vehicle?.year || "",
        make: vehicle?.make || "",
        model: vehicle?.model || "",
        engine: vehicle?.engine || undefined,
        yardLocation: vehicle?.location || undefined,
        employeeId: event.actorId,
        employeeName: event.actorName,
        dismantlingEventId: event.id,
        approvedAt: event.createdAt,
      };

      const record: PartRecord = {
        id: `dp-${event.partId}`,
        status: "approved",
        stage: "needs_processing",
        partCode,
        capturedByName: event.actorName,
        createdAt: event.createdAt,
        photos: [
          { id: `${event.partId}-capture`, type: "capture" },
          { id: `${event.partId}-source`, type: "source" },
        ],
        draft: {
          sourceVin: donor.vin,
          sourceLot: donor.stockNumber,
          partName: partType,
          category: detailedCategoryLabel(partType),
          partNumber: "",
          sideLocation: "",
          condition: "Used",
          fitment: "FITMENT VERIFICATION REQUIRED",
          fitmentStatus: "verification_required",
          title: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model} ${partType}` : partType,
          description: "",
          keywords: "",
          price: "",
          location: "",
          needsReview: ["partNumber", "fitment", "title", "price"],
        },
        stockSku: null,
        operationalStatus: "AVAILABLE",
        quantity: 1,
        zone: "",
        rack: "",
        shelf: "",
        bin: "",
        history: [],
        logs: [
          {
            action: "DISMANTLING_APPROVED",
            userName: event.actorName,
            createdAt: event.createdAt,
            summary: `${partType} approved from Dismantling · donor ${donor.year} ${donor.make} ${donor.model} (VIN ${donor.vin || "—"})`,
          },
        ],
        donor,
        testStatus: "Not Tested",
      };
      // Suggested OEM number is AI/dismantling-sourced and unverified until a Parts staffer confirms it.
      record.draft.partNumber = suggestedOem(event.partId);
      record.draft.needsReview = ["partNumber", "fitment", "title", "price"];
      return record;
    });
  }, [events, vehicles]);

  const parts = useMemo(
    () => [
      ...manualParts.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p)),
      ...derivedParts.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p)),
    ],
    [manualParts, derivedParts, overrides]
  );

  const getPart = useCallback((id: string) => parts.find((p) => p.id === id), [parts]);

  const addCapture = useCallback(() => {
    const id = `part-${Date.now()}`;
    setManualParts((xs) => [
      {
        id,
        status: "captured",
        stage: "needs_processing",
        partCode: `PC-${1000 + xs.length + 1}`,
        capturedByName: "You",
        createdAt: new Date().toISOString(),
        photos: [
          { id: `${id}-capture`, type: "capture" },
          { id: `${id}-source`, type: "source" },
        ],
        draft: {},
        stockSku: null,
        operationalStatus: "AVAILABLE",
        quantity: 1,
        zone: "",
        rack: "",
        shelf: "",
        bin: "",
        history: [],
        logs: [{ action: "CAPTURED", userName: "You", createdAt: new Date().toISOString(), summary: "Part and source photos linked" }],
      },
      ...xs,
    ]);
    return id;
  }, []);

  const setDraft = useCallback((id: string, draft: PartDraft) => {
    setManualParts((xs) => xs.map((p) => (p.id === id ? { ...p, draft } : p)));
  }, []);

  const setStatus = useCallback((id: string, status: PartStatus, actorName: string, summary: string) => {
    setManualParts((xs) =>
      xs.map((p) =>
        p.id === id
          ? { ...p, status, logs: [{ action: status.toUpperCase(), userName: actorName, createdAt: new Date().toISOString(), summary }, ...p.logs] }
          : p
      )
    );
  }, []);

  const approve = useCallback((id: string, draft: PartDraft, actorName: string) => {
    const sku = `SKU-${stockCounter++}`;
    setManualParts((xs) =>
      xs.map((p) =>
        p.id === id
          ? {
              ...p,
              status: "approved",
              stage: "ready_for_sale",
              partCode: sku,
              draft,
              stockSku: sku,
              history: [
                {
                  id: `h-${Date.now()}`,
                  actionType: "APPROVED",
                  previousLocation: null,
                  newLocation: draft.location || p.draft.location || "Parts Inventory",
                  previousStatus: null,
                  newStatus: "AVAILABLE",
                  previousQuantity: null,
                  newQuantity: 1,
                  userName: actorName,
                  createdAt: new Date().toISOString(),
                },
                ...p.history,
              ],
              logs: [
                { action: "APPROVED", userName: actorName, createdAt: new Date().toISOString(), summary: `Approved to Parts Inventory · ${sku}` },
                ...p.logs,
              ],
            }
          : p
      )
    );
    return sku;
  }, []);

  const saveOperations = useCallback((id: string, input: ProcessingInput, actorName: string) => {
    setManualParts((xs) =>
      xs.map((p) => {
        if (p.id !== id) return p;
        const newLocation = [input.zone, input.rack, input.shelf, input.bin].filter(Boolean).join("-") || p.draft.location || "";
        const entry = {
          id: `h-${Date.now()}`,
          actionType: "STATUS_CHANGE",
          previousLocation: p.draft.location || null,
          newLocation,
          previousStatus: p.operationalStatus,
          newStatus: input.operationalStatus,
          previousQuantity: p.quantity,
          newQuantity: input.quantity,
          userName: actorName,
          createdAt: new Date().toISOString(),
          note: input.note || undefined,
        };
        return {
          ...p,
          zone: input.zone,
          rack: input.rack,
          shelf: input.shelf,
          bin: input.bin,
          operationalStatus: input.operationalStatus,
          quantity: input.quantity,
          draft: { ...p.draft, location: newLocation || p.draft.location },
          history: [entry, ...p.history],
        };
      })
    );
  }, []);

  const addFinalPhoto = useCallback((id: string) => {
    setManualParts((xs) =>
      xs.map((p) => (p.id === id ? { ...p, photos: [...p.photos, { id: `${id}-final-${Date.now()}`, type: "final" }] } : p))
    );
  }, []);

  // --- New Parts Inventory processing-workspace primitives (A5-A14) -------------------
  const patchPart = useCallback(
    (id: string, patch: Partial<PartRecord>, actorName: string, logAction: string, logSummary: string) => {
      setOverrides((prev) => {
        const current = mergedPart(id, manualParts, derivedParts, prev);
        if (!current) return prev;
        const nextLogs = [{ action: logAction, userName: actorName, createdAt: new Date().toISOString(), summary: logSummary }, ...current.logs];
        return { ...prev, [id]: { ...prev[id], ...patch, logs: nextLogs } };
      });
    },
    [manualParts, derivedParts]
  );

  const setStage = useCallback(
    (id: string, stage: PartStage, actorName: string, summary: string) => {
      patchPart(id, { stage }, actorName, "STAGE_CHANGE", summary);
    },
    [patchPart]
  );

  const completeProcessing = useCallback(
    (id: string, actorName: string) => {
      setOverrides((prev) => {
        const current = mergedPart(id, manualParts, derivedParts, prev);
        if (!current) return prev;
        const sku = current.stockSku || `SKU-${stockCounter++}`;
        const nextLogs = [
          { action: "COMPLETE_PROCESSING", userName: actorName, createdAt: new Date().toISOString(), summary: `Processing complete · Ready for Sale · ${sku}` },
          ...current.logs,
        ];
        return { ...prev, [id]: { ...prev[id], stage: "ready_for_sale", stockSku: sku, partCode: current.partCode.startsWith("NP-") ? sku : current.partCode, logs: nextLogs } };
      });
    },
    [manualParts, derivedParts]
  );

  const setNotSellable = useCallback(
    (id: string, reason: string, notes: string, actorName: string) => {
      patchPart(
        id,
        {
          stage: "not_sellable",
          notSellable: { reason, notes: notes || undefined, markedBy: actorName, markedAt: new Date().toISOString() },
        },
        actorName,
        "NOT_SELLABLE",
        `Removed from sellable inventory — ${reason}`
      );
    },
    [patchPart]
  );

  const addProcessingPhoto = useCallback(
    (id: string, url: string, actorName: string) => {
      setOverrides((prev) => {
        const current = mergedPart(id, manualParts, derivedParts, prev);
        if (!current) return prev;
        const photos = [...current.photos, { id: `${id}-proc-${Date.now()}`, type: "final" as const, url }];
        const nextLogs = [{ action: "PHOTO_ADDED", userName: actorName, createdAt: new Date().toISOString(), summary: "Photo added during processing" }, ...current.logs];
        return { ...prev, [id]: { ...prev[id], photos, logs: nextLogs } };
      });
    },
    [manualParts, derivedParts]
  );

  const value: PartsDataValue = {
    parts,
    getPart,
    addCapture,
    setDraft,
    setStatus,
    approve,
    saveOperations,
    addFinalPhoto,
    patchPart,
    setStage,
    completeProcessing,
    setNotSellable,
    addProcessingPhoto,
  };

  return <PartsDataContext.Provider value={value}>{children}</PartsDataContext.Provider>;
}

export function usePartsData() {
  const ctx = useContext(PartsDataContext);
  if (!ctx) throw new Error("usePartsData must be used within PartsDataProvider");
  return ctx;
}
