"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  containerJobs as seedJobs,
  exportInvoices as seedInvoices,
  emptyContainer,
  type ContainerJob,
  type ExportInvoice,
  type ExportLine,
} from "@/lib/mock/containers";

let invoiceSeq = 5502;

type ContainersDataValue = {
  jobs: ContainerJob[];
  invoices: ExportInvoice[];
  getJob: (id: string) => ContainerJob | undefined;
  getInvoice: (containerId: string) => ExportInvoice | undefined;
  createJob: (form: typeof emptyContainer) => string;
  updateJob: (id: string, form: Partial<ContainerJob>) => void;
  addFile: (containerId: string, kind: "loading_photo" | "loading_list" | "document", filename: string, isImage: boolean) => void;
  addEvent: (containerId: string, userName: string, action: string, note: string) => void;
  createInvoice: (containerId: string) => void;
  runAiDraft: (containerId: string) => void;
  updateInvoice: (id: string, patch: Partial<ExportInvoice>) => void;
  setInvoiceItems: (id: string, items: ExportLine[]) => void;
  saveInvoice: (id: string, finalize: boolean) => void;
};

const ContainersDataContext = createContext<ContainersDataValue | null>(null);

export function ContainersDataProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ContainerJob[]>(seedJobs);
  const [invoices, setInvoices] = useState<ExportInvoice[]>(seedInvoices);

  const getJob = useCallback((id: string) => jobs.find((j) => j.id === id), [jobs]);
  const getInvoice = useCallback((containerId: string) => invoices.find((i) => i.containerId === containerId), [invoices]);

  const createJob = useCallback((form: typeof emptyContainer) => {
    const id = `cont-${Date.now()}`;
    setJobs((xs) => [{ ...form, id, files: [], events: [] }, ...xs]);
    return id;
  }, []);

  const updateJob = useCallback((id: string, form: Partial<ContainerJob>) => {
    setJobs((xs) => xs.map((j) => (j.id === id ? { ...j, ...form } : j)));
  }, []);

  const addFile = useCallback((containerId: string, kind: "loading_photo" | "loading_list" | "document", filename: string, isImage: boolean) => {
    setJobs((xs) => xs.map((j) => (j.id === containerId ? { ...j, files: [...j.files, { id: `f-${Date.now()}`, kind, filename, isImage }] } : j)));
  }, []);

  const addEvent = useCallback((containerId: string, userName: string, action: string, note: string) => {
    setJobs((xs) =>
      xs.map((j) => (j.id === containerId ? { ...j, events: [...j.events, { id: `e-${Date.now()}`, createdAt: new Date().toISOString(), userName, action, note }] } : j))
    );
  }, []);

  const createInvoice = useCallback((containerId: string) => {
    const id = `inv-${Date.now()}`;
    const number = `EXP-${invoiceSeq++}`;
    setInvoices((xs) => [
      { id, containerId, invoiceNumber: number, status: "Draft", consignee: "", destination: "", currency: "USD", notes: "", items: [], needsReview: [], finalizedAt: null, createdAt: new Date().toISOString() },
      ...xs,
    ]);
  }, []);

  const runAiDraft = useCallback(
    (containerId: string) => {
      setInvoices((xs) =>
        xs.map((inv) => {
          if (inv.containerId !== containerId) return inv;
          const items: ExportLine[] = [
            { description: "Assorted used auto parts per loading list", quantity: 8, unitPrice: 95, category: "Cargo items", condition: "Used" },
          ];
          return { ...inv, items, consignee: inv.consignee, needsReview: ["unitPrice", "category"] };
        })
      );
    },
    []
  );

  const updateInvoice = useCallback((id: string, patch: Partial<ExportInvoice>) => {
    setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const setInvoiceItems = useCallback((id: string, items: ExportLine[]) => {
    setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, items } : i)));
  }, []);

  const saveInvoice = useCallback((id: string, finalize: boolean) => {
    setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, status: finalize ? "Final" : "Draft", finalizedAt: finalize ? new Date().toISOString() : i.finalizedAt, needsReview: finalize ? [] : i.needsReview } : i)));
  }, []);

  const value: ContainersDataValue = {
    jobs,
    invoices,
    getJob,
    getInvoice,
    createJob,
    updateJob,
    addFile,
    addEvent,
    createInvoice,
    runAiDraft,
    updateInvoice,
    setInvoiceItems,
    saveInvoice,
  };

  return <ContainersDataContext.Provider value={value}>{children}</ContainersDataContext.Provider>;
}

export function useContainersData() {
  const ctx = useContext(ContainersDataContext);
  if (!ctx) throw new Error("useContainersData must be used within ContainersDataProvider");
  return ctx;
}
