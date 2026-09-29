"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { parts as seedParts, type PartDraft, type PartRecord, type PartStatus } from "@/lib/mock/parts";

type PartsDataValue = {
  parts: PartRecord[];
  getPart: (id: string) => PartRecord | undefined;
  addCapture: () => string;
  setDraft: (id: string, draft: PartDraft) => void;
  setStatus: (id: string, status: PartStatus, actorName: string, summary: string) => void;
  approve: (id: string, draft: PartDraft, actorName: string) => string;
  addFinalPhoto: (id: string) => void;
  saveOperations: (
    id: string,
    input: { zone: string; rack: string; shelf: string; bin: string; operationalStatus: string; quantity: number; note: string },
    actorName: string
  ) => void;
};

const PartsDataContext = createContext<PartsDataValue | null>(null);

let stockCounter = 10046;

export function PartsDataProvider({ children }: { children: React.ReactNode }) {
  const [parts, setParts] = useState<PartRecord[]>(seedParts);

  const getPart = useCallback((id: string) => parts.find((p) => p.id === id), [parts]);

  const addCapture = useCallback(() => {
    const id = `part-${Date.now()}`;
    setParts((xs) => [
      {
        id,
        status: "captured",
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
    setParts((xs) => xs.map((p) => (p.id === id ? { ...p, draft } : p)));
  }, []);

  const setStatus = useCallback((id: string, status: PartStatus, actorName: string, summary: string) => {
    setParts((xs) =>
      xs.map((p) =>
        p.id === id
          ? { ...p, status, logs: [{ action: status.toUpperCase(), userName: actorName, createdAt: new Date().toISOString(), summary }, ...p.logs] }
          : p
      )
    );
  }, []);

  const approve = useCallback((id: string, draft: PartDraft, actorName: string) => {
    const sku = `SKU-${stockCounter++}`;
    setParts((xs) =>
      xs.map((p) =>
        p.id === id
          ? {
              ...p,
              status: "approved",
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

  const saveOperations = useCallback(
    (
      id: string,
      input: { zone: string; rack: string; shelf: string; bin: string; operationalStatus: string; quantity: number; note: string },
      actorName: string
    ) => {
      setParts((xs) =>
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
    },
    []
  );

  const addFinalPhoto = useCallback((id: string) => {
    setParts((xs) =>
      xs.map((p) => (p.id === id ? { ...p, photos: [...p.photos, { id: `${id}-final-${Date.now()}`, type: "final" }] } : p))
    );
  }, []);

  const value: PartsDataValue = { parts, getPart, addCapture, setDraft, setStatus, approve, saveOperations, addFinalPhoto };

  return <PartsDataContext.Provider value={value}>{children}</PartsDataContext.Provider>;
}

export function usePartsData() {
  const ctx = useContext(PartsDataContext);
  if (!ctx) throw new Error("usePartsData must be used within PartsDataProvider");
  return ctx;
}
