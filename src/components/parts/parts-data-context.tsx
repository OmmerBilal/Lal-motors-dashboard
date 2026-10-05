"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PartDraft, PartRecord, PartStage, PartStatus } from "@/lib/mock/parts";
import {
  getPartDetail,
  listPartsPage,
  markPartNotSellable,
  reopenPartProcessing,
  rowToPart,
  setPartOperationalStatus,
  setPartStage,
  updatePartFields,
  type PartDetailPayload,
} from "@/lib/data/parts";
import { approveDismantledPart, editAndApprovePart, keepPartForReview, rejectDismantledPart } from "@/lib/data/processing";

/**
 * Parts Inventory, backed by the database. The approved views keep the same API they always used.
 * What changed: every change is an RPC call, failures are shown, and no change is shown as saved
 * before the database accepts it. Local draft edits are a UI overlay until a Save writes them.
 */

type ProcessingInput = {
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  operationalStatus: string;
  quantity: number;
  note: string;
};

export const partsKeys = {
  all: ["parts"] as const,
  list: () => ["parts", "list"] as const,
  detail: (id: string) => ["parts", "detail", id] as const,
};

type PartsDataValue = {
  parts: PartRecord[];
  /** The list is paged. Only pages already requested are in `parts`; the views ask for the next page. */
  hasMoreParts: boolean;
  loadingMoreParts: boolean;
  loadMoreParts: () => void;
  getPart: (id: string) => PartRecord | undefined;
  addCapture: () => string;
  setDraft: (id: string, draft: PartDraft) => void;
  setStatus: (id: string, status: PartStatus | "rejected", actorName: string, summary: string) => void;
  approve: (id: string, draft: PartDraft, actorName: string) => string;
  addFinalPhoto: (id: string) => void;
  saveOperations: (id: string, input: ProcessingInput, actorName: string) => void;
  patchPart: (id: string, patch: Partial<PartRecord>, actorName: string, logAction: string, logSummary: string) => void;
  setStage: (id: string, stage: PartStage, actorName: string, summary: string) => void;
  completeProcessing: (id: string, actorName: string) => void;
  setNotSellable: (id: string, reason: string, notes: string, actorName: string) => void;
  addProcessingPhoto: (id: string, url: string, actorName: string) => void;
};

const PartsDataContext = createContext<PartsDataValue | null>(null);

// Draft keys the database accepts through update_part_fields, mapped from the view's draft names.
const DRAFT_TO_DB: Partial<Record<keyof PartDraft, string>> = {
  partName: "part_name",
  category: "category",
  partNumber: "part_number",
  sideLocation: "side_location",
  condition: "condition",
  fitment: "fitment",
  fitmentStatus: "fitment_status",
  title: "title",
  description: "description",
  keywords: "keywords",
  price: "price",
  location: "location",
};

const RECORD_TO_DB: Partial<Record<keyof PartRecord, string>> = {
  zone: "zone",
  rack: "rack",
  shelf: "shelf",
  bin: "bin",
  stockSku: "stock_sku",
  coreCharge: "core_charge",
  hasCoreCharge: "has_core_charge",
  saleChannels: "sale_channels",
  testStatus: "test_status",
  testNotes: "test_notes",
  partNotes: "part_notes",
};

function errText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

export function PartsDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const listQ = useInfiniteQuery({
    queryKey: partsKeys.list(),
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) => listPartsPage(pageParam, 50),
    getNextPageParam: (last, pages) => {
      if (!last.hasMore || last.rows.length === 0) return undefined;
      const tail = last.rows[last.rows.length - 1];
      void pages;
      return { createdAt: tail.created_at, id: tail.id };
    },
    staleTime: 60_000,
  });
  const [overlay, setOverlay] = useState<Record<string, PartDraft>>({});

  const fetchNextParts = listQ.fetchNextPage;
  const parts = useMemo<PartRecord[]>(
    () =>
      (listQ.data?.pages.flatMap((page) => page.rows) ?? []).map((row) => {
        const base = rowToPart(row);
        return overlay[row.id] ? { ...base, draft: { ...base.draft, ...overlay[row.id] } } : base;
      }),
    [listQ.data, overlay]
  );
  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: partsKeys.list() });
    queryClient.invalidateQueries({ queryKey: ["parts", "detail"] });
  }, [queryClient]);

  const getPart = useCallback((id: string) => byId.get(id), [byId]);

  /** Local draft edit only. It is not saved until a Save action writes it through the database. */
  const setDraft = useCallback((id: string, draft: PartDraft) => {
    setOverlay((o) => ({ ...o, [id]: { ...(o[id] ?? {}), ...draft } }));
  }, []);

  const setStage = useCallback(
    async (id: string, stage: PartStage, _actorName: string, summary: string) => {
      try {
        await setPartStage(id, stage, summary);
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The stage was not changed."));
      }
    },
    [invalidate]
  );

  const completeProcessing = useCallback(
    async (id: string) => {
      try {
        await setPartStage(id, "ready_for_sale", "Processing complete");
        toast.success("Part is ready for sale");
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The part is not ready for sale yet."));
      }
    },
    [invalidate]
  );

  const setNotSellable = useCallback(
    async (id: string, reason: string) => {
      try {
        await markPartNotSellable(id, reason);
        toast.success("Marked not sellable");
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The part was not marked not sellable."));
      }
    },
    [invalidate]
  );

  const setStatus = useCallback(
    async (id: string, status: PartStatus | "rejected", _actorName: string, summary: string) => {
      try {
        if (status === "approved") await approveDismantledPart(id);
        else if (status === "manager_review") await keepPartForReview(id);
        else if (status === "rejected") await rejectDismantledPart(id, summary);
        else {
          toast.error("That status change is not available. Nothing was changed.");
          return;
        }
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The change was not saved."));
      }
    },
    [invalidate]
  );

  const approve = useCallback(
    (id: string, draft: PartDraft) => {
      const fields: Record<string, string> = {};
      if (draft.partName) fields.part_name = draft.partName;
      if (draft.category) fields.category = draft.category;
      if (draft.partNumber) fields.part_number = draft.partNumber;
      if (draft.condition) fields.condition = draft.condition;
      if (draft.location) fields.location = draft.location;
      const run = Object.keys(fields).length
        ? editAndApprovePart(id, fields)
        : approveDismantledPart(id);
      run
        .then(() => {
          toast.success("Approved");
          invalidate();
        })
        .catch((err) => toast.error(errText(err, "The part was not approved.")));
      return id;
    },
    [invalidate]
  );

  const saveOperations = useCallback(
    async (id: string, input: ProcessingInput) => {
      const current = byId.get(id);
      if (!current) return;
      try {
        await updatePartFields(id, { zone: input.zone, rack: input.rack, shelf: input.shelf, bin: input.bin }, input.note || undefined);
        if (input.operationalStatus && input.operationalStatus !== current.operationalStatus) {
          if (!input.note) {
            toast.error("Add a note to change the operational state.");
          } else {
            await setPartOperationalStatus(id, input.operationalStatus, input.note);
          }
        }
        if (input.quantity !== current.quantity) {
          toast.error("Quantity changes come from sales and stock moves, so they are not edited here.");
        }
        setOverlay((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The location was not saved."));
      }
    },
    [byId, invalidate]
  );

  const patchPart = useCallback(
    async (id: string, patch: Partial<PartRecord>, _actorName: string, _logAction: string, logSummary: string) => {
      const fields: Record<string, string | boolean | string[]> = {};
      for (const [k, v] of Object.entries(patch.draft ?? {})) {
        const db = DRAFT_TO_DB[k as keyof PartDraft];
        if (db && typeof v === "string") fields[db] = v;
      }
      for (const [k, v] of Object.entries(patch)) {
        const db = RECORD_TO_DB[k as keyof PartRecord];
        if (!db || v === undefined || v === null) continue;
        fields[db] = Array.isArray(v) ? (v as string[]) : typeof v === "boolean" ? v : String(v);
      }
      try {
        if (Object.keys(fields).length) await updatePartFields(id, fields, logSummary || undefined);
        if (patch.stage) await setPartStage(id, patch.stage, logSummary || undefined);
        if (patch.operationalStatus) await setPartOperationalStatus(id, patch.operationalStatus, logSummary || "Operational state changed");
        setOverlay((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
        invalidate();
      } catch (err) {
        toast.error(errText(err, "The change was not saved."));
      }
    },
    [invalidate]
  );

  const addCapture = useCallback(() => {
    toast.error("Warehouse part capture is not connected yet. Use Dismantling for captures from vehicles.");
    return "";
  }, []);

  // Photos attach through the shared capture component on the part. These two entry points are not wired.
  const addFinalPhoto = useCallback(() => {
    toast.info("Photo capture on this part is not connected in this view yet.");
  }, []);
  const addProcessingPhoto = useCallback(() => {
    toast.info("Photo capture on this part is not connected in this view yet.");
  }, []);

  const value = useMemo<PartsDataValue>(
    () => ({
      parts,
      hasMoreParts: !!listQ.hasNextPage,
      loadingMoreParts: listQ.isFetchingNextPage,
      loadMoreParts: () => {
        void fetchNextParts();
      },
      getPart,
      addCapture,
      setDraft,
      setStatus,
      approve,
      addFinalPhoto,
      saveOperations,
      patchPart,
      setStage,
      completeProcessing,
      setNotSellable,
      addProcessingPhoto,
    }),
    [parts, listQ.hasNextPage, listQ.isFetchingNextPage, fetchNextParts, getPart, addCapture, setDraft, setStatus, approve, addFinalPhoto, saveOperations, patchPart, setStage, completeProcessing, setNotSellable, addProcessingPhoto]
  );

  return <PartsDataContext.Provider value={value}>{children}</PartsDataContext.Provider>;
}

export function usePartsData() {
  const ctx = useContext(PartsDataContext);
  if (!ctx) throw new Error("usePartsData must be used within PartsDataProvider");
  return ctx;
}

/** Donor vehicle, session, photo ids and history for one part, loaded only when its detail is open. */
export function usePartDetailRecord(partId: string): { data: PartDetailPayload | undefined; isLoading: boolean; error: Error | null } {
  const q = useQuery({
    queryKey: partsKeys.detail(partId),
    queryFn: () => getPartDetail(partId),
    enabled: !!partId,
  });
  return { data: q.data, isLoading: q.isLoading, error: q.error as Error | null };
}

// Re-exported for views that reopen a not-sellable part.
export { reopenPartProcessing };
