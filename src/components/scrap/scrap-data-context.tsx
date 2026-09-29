"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { scrapLoads as seedLoads, scrapChecks as seedChecks, type ScrapLoad, type ScrapCheck } from "@/lib/mock/scrap";
import { mockUsers } from "@/lib/mock/users";

type ScrapDataValue = {
  loads: ScrapLoad[];
  checks: ScrapCheck[];
  drivers: { id: string; name: string }[];
  createLoad: (driverId: string, driverName: string, loadDate: string) => ScrapLoad;
  saveTicket: (id: string) => void;
  saveMeasurements: (id: string, weight: string, amount: string, ticketNumber: string) => void;
  saveCheck: (driverId: string, loadDate: string, checkNumber: string) => number;
};

const ScrapDataContext = createContext<ScrapDataValue | null>(null);

export function ScrapDataProvider({ children }: { children: React.ReactNode }) {
  const [loads, setLoads] = useState<ScrapLoad[]>(seedLoads);
  const [checks, setChecks] = useState<ScrapCheck[]>(seedChecks);

  const drivers = mockUsers.filter((u) => u.role === "scrap_driver").map((u) => ({ id: u.id, name: u.name }));

  const createLoad = useCallback((driverId: string, driverName: string, loadDate: string) => {
    const load: ScrapLoad = {
      id: `scrap-${Date.now()}`,
      driverId,
      driverName,
      loadDate,
      createdAt: new Date().toISOString(),
      ticketUploadedAt: null,
      weightAmount: null,
      amount: null,
      ticketNumber: null,
      checkId: null,
      checkNumber: null,
    };
    setLoads((xs) => [load, ...xs]);
    return load;
  }, []);

  const saveTicket = useCallback((id: string) => {
    setLoads((xs) => xs.map((l) => (l.id === id ? { ...l, ticketUploadedAt: new Date().toISOString() } : l)));
  }, []);

  const saveMeasurements = useCallback((id: string, weight: string, amount: string, ticketNumber: string) => {
    setLoads((xs) =>
      xs.map((l) =>
        l.id === id
          ? { ...l, weightAmount: weight === "" ? null : Number(weight), amount: amount === "" ? null : Number(amount), ticketNumber: ticketNumber || null }
          : l
      )
    );
  }, []);

  const saveCheck = useCallback(
    (driverId: string, loadDate: string, checkNumber: string) => {
      const ready = loads.filter(
        (l) => l.driverId === driverId && l.loadDate === loadDate && !l.checkId && l.ticketUploadedAt && l.weightAmount !== null && l.amount !== null && l.ticketNumber
      );
      const checkId = `check-${Date.now()}`;
      setChecks((xs) => [{ id: checkId, driverId, loadDate, checkNumber, createdAt: new Date().toISOString() }, ...xs]);
      setLoads((xs) => xs.map((l) => (ready.some((r) => r.id === l.id) ? { ...l, checkId, checkNumber } : l)));
      return ready.length;
    },
    [loads]
  );

  const value: ScrapDataValue = { loads, checks, drivers, createLoad, saveTicket, saveMeasurements, saveCheck };

  return <ScrapDataContext.Provider value={value}>{children}</ScrapDataContext.Provider>;
}

export function useScrapData() {
  const ctx = useContext(ScrapDataContext);
  if (!ctx) throw new Error("useScrapData must be used within ScrapDataProvider");
  return ctx;
}
