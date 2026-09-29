"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  carriers as seedCarriers,
  dispatchVehicles as seedVehicles,
  dispatchJobs as seedJobs,
  type Carrier,
  type DispatchItem,
  type DispatchJob,
  type DispatchVehicle,
} from "@/lib/mock/central-dispatch";

type NewCarrier = Omit<Carrier, "id">;

type DispatchDataValue = {
  vehicles: DispatchVehicle[];
  carriers: Carrier[];
  jobs: DispatchJob[];
  addVehicle: (v: Omit<DispatchVehicle, "id" | "dispatchId" | "dispatchStatus" | "dispatchDate" | "company" | "arrivalDate">) => string;
  addCarrier: (c: NewCarrier) => string;
  createDispatch: (input: {
    carrierId: string;
    destination: string;
    vehicleIds: string[];
    prices: Record<string, string>;
    locations: Record<string, string>;
  }) => string;
  advanceItemStatus: (jobId: string, vehicleId: string, status: DispatchItem["status"]) => void;
  recordArrival: (vehicleId: string, yardLocation: string) => void;
  addNote: (jobId: string, note: string) => void;
};

const DispatchDataContext = createContext<DispatchDataValue | null>(null);

export function DispatchDataProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles] = useState<DispatchVehicle[]>(seedVehicles);
  const [carriers, setCarriers] = useState<Carrier[]>(seedCarriers);
  const [jobs, setJobs] = useState<DispatchJob[]>(seedJobs);

  const addVehicle = useCallback<DispatchDataValue["addVehicle"]>((v) => {
    const id = `dv-${Date.now()}`;
    setVehicles((xs) => [
      { ...v, id, dispatchId: null, dispatchStatus: null, dispatchDate: null, company: null, arrivalDate: null },
      ...xs,
    ]);
    return id;
  }, []);

  const addCarrier = useCallback((c: NewCarrier) => {
    const id = `car-${Date.now()}`;
    setCarriers((xs) => [{ ...c, id }, ...xs]);
    return id;
  }, []);

  const createDispatch = useCallback<DispatchDataValue["createDispatch"]>(
    ({ carrierId, destination, vehicleIds, prices, locations }) => {
      const carrier = carriers.find((c) => c.id === carrierId);
      const id = `job-${Date.now()}`;
      const items: DispatchItem[] = vehicleIds.map((vid) => {
        const v = vehicles.find((x) => x.id === vid)!;
        return {
          id: `item-${Date.now()}-${vid}`,
          vehicleId: vid,
          lotNumber: v.lotNumber,
          vin: v.vin,
          year: v.year,
          make: v.make,
          model: v.model,
          pickupLocation: locations[vid] ?? v.location,
          price: Number(prices[vid]) || 0,
          status: "Assigned",
        };
      });
      setJobs((xs) => [
        {
          id,
          carrierId,
          company: carrier?.company || "",
          driver: carrier?.driver || "",
          phone: carrier?.phone || "",
          email: carrier?.email || "",
          destination,
          status: "Assigned",
          createdAt: new Date().toISOString(),
          items,
          notes: [],
        },
        ...xs,
      ]);
      setVehicles((xs) =>
        xs.map((v) =>
          vehicleIds.includes(v.id)
            ? { ...v, status: "Assigned", dispatchId: id, dispatchStatus: "Assigned", dispatchDate: new Date().toISOString().slice(0, 10), company: carrier?.company || "" }
            : v
        )
      );
      return id;
    },
    [carriers, vehicles]
  );

  const advanceItemStatus = useCallback((jobId: string, vehicleId: string, status: DispatchItem["status"]) => {
    setJobs((xs) =>
      xs.map((j) => {
        if (j.id !== jobId) return j;
        const items = j.items.map((i) => (i.vehicleId === vehicleId ? { ...i, status } : i));
        const allArrived = items.every((i) => i.status === "Arrived");
        const someArrived = items.some((i) => i.status === "Arrived");
        return { ...j, items, status: allArrived ? "Delivered" : someArrived ? "Partial Delivery" : j.status };
      })
    );
    setVehicles((xs) => xs.map((v) => (v.id === vehicleId ? { ...v, status, dispatchStatus: status } : v)));
  }, []);

  const recordArrival = useCallback((vehicleId: string, yardLocation: string) => {
    setVehicles((xs) =>
      xs.map((v) =>
        v.id === vehicleId
          ? { ...v, status: "Arrived", dispatchStatus: "Arrived", location: yardLocation || v.location, arrivalDate: new Date().toISOString().slice(0, 10) }
          : v
      )
    );
    setJobs((xs) =>
      xs.map((j) => {
        const items = j.items.map((i) => (i.vehicleId === vehicleId ? { ...i, status: "Arrived" as const } : i));
        if (!items.some((i) => i.vehicleId === vehicleId)) return j;
        const allArrived = items.every((i) => i.status === "Arrived");
        return { ...j, items, status: allArrived ? "Delivered" : "Partial Delivery" };
      })
    );
  }, []);

  const addNote = useCallback((jobId: string, note: string) => {
    setJobs((xs) =>
      xs.map((j) =>
        j.id === jobId
          ? { ...j, notes: [{ id: `note-${Date.now()}`, actorName: "You", createdAt: new Date().toISOString(), note }, ...j.notes] }
          : j
      )
    );
  }, []);

  const value: DispatchDataValue = {
    vehicles,
    carriers,
    jobs,
    addVehicle,
    addCarrier,
    createDispatch,
    advanceItemStatus,
    recordArrival,
    addNote,
  };

  return <DispatchDataContext.Provider value={value}>{children}</DispatchDataContext.Provider>;
}

export function useDispatchData() {
  const ctx = useContext(DispatchDataContext);
  if (!ctx) throw new Error("useDispatchData must be used within DispatchDataProvider");
  return ctx;
}
