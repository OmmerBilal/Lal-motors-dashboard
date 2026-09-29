"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  vehicles as seedVehicles,
  vehicleEvents as seedEvents,
  completionQueue as seedCompletionQueue,
  yardCorrections as seedCorrections,
  intakeBatches as seedBatches,
  type VehicleRecord,
  type VehicleEvent,
  type VehicleEventAction,
  type CompletionSubmission,
  type YardCorrection,
  type IntakeBatch,
  type IntakeDraft,
} from "@/lib/mock/vehicles";
import { mockUsers } from "@/lib/mock/users";

type VehicleDataValue = {
  vehicles: VehicleRecord[];
  events: VehicleEvent[];
  batches: IntakeBatch[];
  completionQueue: CompletionSubmission[];
  corrections: YardCorrection[];
  staff: { id: string; name: string; role: string }[];
  getVehicle: (id: string) => VehicleRecord | undefined;
  vehicleEvents: (id: string) => VehicleEvent[];
  updateVehicle: (id: string, patch: Partial<VehicleRecord>) => void;
  confirmDrafts: (drafts: IntakeDraft[]) => string[];
  recordEvent: (
    input: Omit<VehicleEvent, "id" | "createdAt" | "actorName"> & { actorId: string; assigneeId?: string }
  ) => void;
  addBatch: (method: IntakeBatch["method"], count: number) => string;
  decideCompletion: (submissionId: string, decision: "approve" | "correction", reason?: string) => void;
};

const VehicleDataContext = createContext<VehicleDataValue | null>(null);

export function VehicleDataProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(seedVehicles);
  const [events, setEvents] = useState<VehicleEvent[]>(seedEvents);
  const [batches, setBatches] = useState<IntakeBatch[]>(seedBatches);
  const [completionQueue, setCompletionQueue] = useState<CompletionSubmission[]>(seedCompletionQueue);
  const [corrections, setCorrections] = useState<YardCorrection[]>(seedCorrections);

  const getVehicle = useCallback((id: string) => vehicles.find((v) => v.id === id), [vehicles]);
  const vehicleEventsFor = useCallback(
    (id: string) => events.filter((e) => e.vehicleId === id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [events]
  );

  const updateVehicle = useCallback((id: string, patch: Partial<VehicleRecord>) => {
    setVehicles((xs) => xs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const confirmDrafts = useCallback((drafts: IntakeDraft[]) => {
    const ids: string[] = [];
    setVehicles((xs) => {
      const created = drafts.map((draft, i) => {
        const id = `veh-${Date.now()}-${i}`;
        ids.push(id);
        const unverified = draft.uncertainFields ?? [];
        return {
          id,
          auctionSource: draft.auctionSource || "Copart",
          vin: draft.vin || "",
          lotNumber: draft.lotNumber || "",
          stockNumber: draft.stockNumber || "",
          auctionItemNumber: draft.auctionItemNumber || "",
          year: draft.year || "",
          make: draft.make || "",
          model: draft.model || "",
          trim: draft.trim || "",
          engine: draft.engine || "",
          mileage: draft.mileage || "",
          mileageStatus: draft.mileageStatus || "Unknown",
          titleStatus: draft.titleStatus || "Pending",
          location: draft.location || "LAL Motors Yard",
          purchasePrice: draft.purchasePrice || "",
          invoiceAmount: draft.invoiceAmount || "",
          balanceDue: draft.balanceDue || "",
          auctionFees: draft.auctionFees || "",
          transportationCost: draft.transportationCost || "",
          saleDate: draft.saleDate || new Date().toISOString().slice(0, 10),
          pickupPin: draft.pickupPin || "",
          pickupStatus: draft.pickupStatus || "",
          pickupDeadline: draft.pickupDeadline || "",
          damageInfo: draft.damageInfo || "",
          transportInfo: draft.transportInfo || "",
          status: "Purchased",
          assignedId: null,
          assignedName: null,
          arrivalDate: null,
          createdAt: new Date().toISOString(),
          unverifiedFields: unverified,
        } satisfies VehicleRecord;
      });
      return [...created, ...xs];
    });
    return ids;
  }, []);

  const recordEvent = useCallback(
    (input: Omit<VehicleEvent, "id" | "createdAt" | "actorName"> & { actorId: string; assigneeId?: string }) => {
      const { assigneeId, ...rest } = input;
      const actor = mockUsers.find((u) => u.id === input.actorId);
      const event: VehicleEvent = {
        ...rest,
        id: `evt-${Date.now()}`,
        createdAt: new Date().toISOString(),
        actorName: actor?.name || "Unknown",
      };
      setEvents((xs) => [event, ...xs]);
      if (input.action === "STATUS" && input.status) {
        updateVehicle(input.vehicleId, { status: input.status });
      }
      if (input.action === "ASSIGN" && assigneeId) {
        const assignee = mockUsers.find((u) => u.id === assigneeId);
        if (assignee) updateVehicle(input.vehicleId, { assignedId: assignee.id, assignedName: assignee.name });
      }
      if (input.action === "COMPLETION_SUBMITTED") {
        updateVehicle(input.vehicleId, { status: "Ready for Processing" });
      }
    },
    [updateVehicle]
  );

  const addBatch = useCallback((method: IntakeBatch["method"], count: number) => {
    const id = `batch-${Date.now()}`;
    setBatches((xs) => [{ id, method, vehicleCount: count, status: "pending", createdAt: new Date().toISOString() }, ...xs]);
    return id;
  }, []);

  const decideCompletion = useCallback(
    (submissionId: string, decision: "approve" | "correction", reason?: string) => {
      const item = completionQueue.find((c) => c.submissionId === submissionId);
      setCompletionQueue((xs) => xs.filter((c) => c.submissionId !== submissionId));
      if (!item) return;
      if (decision === "approve") {
        setEvents((xs) => [
          {
            id: `evt-${Date.now()}`,
            vehicleId: item.vehicleId,
            action: "COMPLETION_APPROVED",
            actorId: "u-owner",
            actorName: "Marcus Lal",
            createdAt: new Date().toISOString(),
          },
          ...xs,
        ]);
        updateVehicle(item.vehicleId, { status: "Ready for Processing" });
      } else {
        setCorrections((xs) => [
          {
            submissionId: item.submissionId,
            vehicleId: item.vehicleId,
            lotNumber: item.lotNumber,
            year: item.year,
            make: item.make,
            model: item.model,
            reason: reason || "Needs correction",
          },
          ...xs,
        ]);
      }
    },
    [completionQueue, updateVehicle]
  );

  const staff = useMemo(
    () => mockUsers.filter((u) => !["scrap_driver"].includes(u.role)).map((u) => ({ id: u.id, name: u.name, role: u.role })),
    []
  );

  const value: VehicleDataValue = {
    vehicles,
    events,
    batches,
    completionQueue,
    corrections,
    staff,
    getVehicle,
    vehicleEvents: vehicleEventsFor,
    updateVehicle,
    confirmDrafts,
    recordEvent,
    addBatch,
    decideCompletion,
  };

  return <VehicleDataContext.Provider value={value}>{children}</VehicleDataContext.Provider>;
}

export function useVehicleData() {
  const ctx = useContext(VehicleDataContext);
  if (!ctx) throw new Error("useVehicleData must be used within VehicleDataProvider");
  return ctx;
}

export type { VehicleEventAction };
