"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  containerJobs as seedJobs,
  exportInvoices as seedInvoices,
  exportPayments as seedPayments,
  consignees as seedConsignees,
  nextTRef,
  invoiceTotal,
  paymentsTotal,
  toLoaderSafeContainer,
  type ContainerJob,
  type ContainerFileKind,
  type ExportInvoice,
  type ExportLine,
  type ExportPayment,
  type Consignee,
  type LoaderSafeContainer,
  type ContainerStatus,
} from "@/lib/mock/containers";

let invoiceSeq = 5600;
let idSeq = 1;
function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${idSeq++}`;
}

export type MarkFinishedResult = { ok: boolean; missing: string[] };
export type CloseResult = { ok: boolean; reason?: string };

type ContainersDataValue = {
  jobs: ContainerJob[];
  loaderJobs: LoaderSafeContainer[];
  invoices: ExportInvoice[];
  payments: ExportPayment[];
  consignees: Consignee[];

  getJob: (id: string) => ContainerJob | undefined;
  getInvoiceForContainer: (containerId: string) => ExportInvoice | undefined;
  getPaymentsForInvoice: (invoiceId: string) => ExportPayment[];
  getConsignee: (id: string | null) => Consignee | undefined;

  createJob: (form: { containerNumber: string; truckingCompany: string; destinationCountry: string; destinationPort: string; consigneeId: string | null }) => { id: string; error?: string };
  updateJobMeta: (id: string, patch: Partial<Pick<ContainerJob, "destinationCountry" | "destinationPort" | "truckingCompany" | "consigneeId" | "notes">>, actorName: string) => void;

  // --- Loading-employee actions (operate only through LoaderSafeContainer ids) ---
  confirmContainerNumber: (id: string, number: string, employeeName: string, aiSuggested: boolean) => { ok: boolean; error?: string };
  addFile: (id: string, kind: ContainerFileKind, caption: string, employeeName: string) => void;
  markLoadingFinished: (id: string, employeeName: string) => MarkFinishedResult;

  // --- Export-manager actions ---
  addConsignee: (form: Omit<Consignee, "id">) => string;
  updateConsignee: (id: string, patch: Partial<Consignee>) => void;
  runLoadingListDraft: (containerId: string) => void;
  createInvoice: (containerId: string) => string;
  updateInvoiceMeta: (id: string, patch: Partial<Pick<ExportInvoice, "destination" | "currency" | "notes" | "consigneeId">>) => void;
  setInvoiceItems: (id: string, items: ExportLine[]) => void;
  moveInvoiceToReview: (id: string) => void;
  finalizeInvoice: (id: string, actorName: string) => void;
  reviseFinalizedInvoice: (id: string, newItems: ExportLine[], reason: string, actorName: string) => void;
  addPayment: (
    invoiceId: string,
    input: { date: string; amount: number; type: ExportPayment["type"]; method: ExportPayment["method"]; referenceNumber: string; notes: string; proofFilename: string | null },
    actorName: string,
    overrideReason?: string
  ) => { ok: boolean; error?: string };
  correctPayment: (paymentId: string, newAmount: number, reason: string, actorName: string) => void;
  markOnTheWay: (containerId: string, input: { shipDate: string; eta: string; note: string }, actorName: string) => void;
  closeContainer: (containerId: string, actorName: string, overrideReason?: string) => CloseResult;
  reopenContainer: (containerId: string, actorName: string, reason: string) => void;
  addEvent: (containerId: string, userName: string, action: string, note: string) => void;
};

const ContainersDataContext = createContext<ContainersDataValue | null>(null);

export function ContainersDataProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ContainerJob[]>(seedJobs);
  const [invoices, setInvoices] = useState<ExportInvoice[]>(seedInvoices);
  const [payments, setPayments] = useState<ExportPayment[]>(seedPayments);
  const [consigneesState, setConsigneesState] = useState<Consignee[]>(seedConsignees);

  const loaderJobs = useMemo(() => jobs.map(toLoaderSafeContainer), [jobs]);

  const getJob = useCallback((id: string) => jobs.find((j) => j.id === id), [jobs]);
  const getInvoiceForContainer = useCallback((containerId: string) => invoices.find((i) => i.containerId === containerId), [invoices]);
  const getPaymentsForInvoice = useCallback((invoiceId: string) => payments.filter((p) => p.invoiceId === invoiceId), [payments]);
  const getConsignee = useCallback((id: string | null) => (id ? consigneesState.find((c) => c.id === id) : undefined), [consigneesState]);

  const addEvent = useCallback((containerId: string, userName: string, action: string, note: string) => {
    setJobs((xs) =>
      xs.map((j) =>
        j.id === containerId
          ? { ...j, lastUpdateAt: new Date().toISOString(), events: [...j.events, { id: nextId("e"), createdAt: new Date().toISOString(), userName, action, note }] }
          : j
      )
    );
  }, []);

  const createJob = useCallback(
    (form: { containerNumber: string; truckingCompany: string; destinationCountry: string; destinationPort: string; consigneeId: string | null }) => {
      const number = form.containerNumber.trim();
      if (number && jobs.some((j) => j.containerNumber.toLowerCase() === number.toLowerCase())) {
        return { id: "", error: `Container number ${number} is already in use.` };
      }
      const id = nextId("cont");
      const tRef = nextTRef();
      const job: ContainerJob = {
        id,
        tRef,
        containerNumber: number,
        numberConfirmed: !!number,
        status: "loading",
        destinationCountry: form.destinationCountry,
        destinationPort: form.destinationPort,
        truckingCompany: form.truckingCompany,
        consigneeId: form.consigneeId,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        shipDate: null,
        eta: null,
        shippingNote: "",
        notes: "",
        createdByName: "Export Manager",
        lastUpdateAt: new Date().toISOString(),
        files: [],
        loadingListDraft: [],
        loadingListConfirmed: false,
        events: [{ id: nextId("e"), createdAt: new Date().toISOString(), userName: "Export Manager", action: "CREATED", note: `Container ${tRef} created` }],
        closedAt: null,
        closedByName: null,
        closeOverrideReason: null,
      };
      setJobs((xs) => [job, ...xs]);
      return { id };
    },
    [jobs]
  );

  const updateJobMeta = useCallback(
    (id: string, patch: Partial<Pick<ContainerJob, "destinationCountry" | "destinationPort" | "truckingCompany" | "consigneeId" | "notes">>, actorName: string) => {
      setJobs((xs) => xs.map((j) => (j.id === id ? { ...j, ...patch, lastUpdateAt: new Date().toISOString() } : j)));
      addEvent(id, actorName, "UPDATED", "Container details updated");
    },
    [addEvent]
  );

  const confirmContainerNumber = useCallback(
    (id: string, number: string, employeeName: string, aiSuggested: boolean) => {
      const trimmed = number.trim();
      if (!trimmed) return { ok: false, error: "Enter a container number." };
      const dup = jobs.find((j) => j.id !== id && j.containerNumber.toLowerCase() === trimmed.toLowerCase());
      if (dup) return { ok: false, error: `Container number ${trimmed} is already used on ${dup.tRef}.` };
      setJobs((xs) =>
        xs.map((j) =>
          j.id === id
            ? {
                ...j,
                containerNumber: trimmed,
                numberConfirmed: true,
                lastUpdateAt: new Date().toISOString(),
                files: [...j.files, { id: nextId("f"), kind: "number_photo", filename: `number-${nextId("img")}.jpg`, caption: "Container Number", isImage: true, employeeName, createdAt: new Date().toISOString() }],
              }
            : j
        )
      );
      addEvent(id, employeeName, "NUMBER_CONFIRMED", aiSuggested ? `Container number photo added; ${trimmed} confirmed from AI suggestion` : `Container number photo added; ${trimmed} entered manually`);
      return { ok: true };
    },
    [jobs, addEvent]
  );

  const addFile = useCallback(
    (id: string, kind: ContainerFileKind, caption: string, employeeName: string) => {
      setJobs((xs) =>
        xs.map((j) =>
          j.id === id
            ? {
                ...j,
                lastUpdateAt: new Date().toISOString(),
                files: [...j.files, { id: nextId("f"), kind, filename: `${kind}-${nextId("img")}.jpg`, caption, isImage: true, employeeName, createdAt: new Date().toISOString() }],
                loadingListConfirmed: kind === "final_list" ? true : j.loadingListConfirmed,
              }
            : j
        )
      );
      addEvent(id, employeeName, kind === "final_list" ? "FINAL_LIST_ADDED" : "PHOTO_ADDED", kind === "final_list" ? "Final loading list photo added" : `${caption} photo added`);
    },
    [addEvent]
  );

  const markLoadingFinished = useCallback(
    (id: string, employeeName: string): MarkFinishedResult => {
      const job = jobs.find((j) => j.id === id);
      if (!job) return { ok: false, missing: ["Container not found"] };
      const missing: string[] = [];
      if (!job.numberConfirmed || !job.files.some((f) => f.kind === "number_photo")) missing.push("Container number photo");
      if (!job.files.some((f) => f.kind === "loading_photo")) missing.push("At least one loading photo");
      if (!job.loadingListConfirmed || !job.files.some((f) => f.kind === "final_list")) missing.push("Final loading list photo");
      if (missing.length) return { ok: false, missing };

      setJobs((xs) => xs.map((j) => (j.id === id ? { ...j, status: "ready_for_invoice", finishedAt: new Date().toISOString(), lastUpdateAt: new Date().toISOString() } : j)));
      addEvent(id, employeeName, "LOADING_FINISHED", "Marked loading finished — moved to Ready for Invoice");
      return { ok: true, missing: [] };
    },
    [jobs, addEvent]
  );

  const addConsignee = useCallback((form: Omit<Consignee, "id">) => {
    const id = nextId("cg");
    setConsigneesState((xs) => [...xs, { ...form, id }]);
    return id;
  }, []);

  const updateConsignee = useCallback((id: string, patch: Partial<Consignee>) => {
    setConsigneesState((xs) => xs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const runLoadingListDraft = useCallback(
    (containerId: string) => {
      const draft: ExportLine[] = [
        { id: nextId("ln"), description: "Assorted used auto parts per loading list (demo AI draft)", quantity: 1, unitPrice: 0, category: "Cargo items", condition: "Used" },
      ];
      setJobs((xs) => xs.map((j) => (j.id === containerId ? { ...j, loadingListDraft: draft } : j)));
      addEvent(containerId, "Export Manager", "LOADING_LIST_DRAFT", "Demo AI transcription drafted from final loading list photo — needs review");
    },
    [addEvent]
  );

  const createInvoice = useCallback(
    (containerId: string) => {
      const job = jobs.find((j) => j.id === containerId);
      const id = nextId("inv");
      const number = `EXP-${invoiceSeq++}`;
      const prefill = job?.loadingListDraft?.length ? job.loadingListDraft.map((it) => ({ ...it, id: nextId("ln") })) : [];
      setInvoices((xs) => [
        {
          id,
          containerId,
          tRef: job?.tRef || "",
          invoiceNumber: number,
          status: "Draft",
          consigneeId: job?.consigneeId ?? null,
          consigneeSnapshot: null,
          destination: job?.destinationPort || "",
          currency: "USD",
          notes: "",
          items: prefill,
          needsReview: prefill.length ? ["unitPrice", "quantity"] : [],
          createdAt: new Date().toISOString(),
          finalizedAt: null,
          revisions: [],
        },
        ...xs,
      ]);
      addEvent(containerId, "Export Manager", "INVOICE_DRAFTED", `Invoice ${number} created`);
      return id;
    },
    [jobs, addEvent]
  );

  const updateInvoiceMeta = useCallback((id: string, patch: Partial<Pick<ExportInvoice, "destination" | "currency" | "notes" | "consigneeId">>) => {
    setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const setInvoiceItems = useCallback((id: string, items: ExportLine[]) => {
    setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, items } : i)));
  }, []);

  const moveInvoiceToReview = useCallback(
    (id: string) => {
      setInvoices((xs) => xs.map((i) => (i.id === id ? { ...i, status: "Review" } : i)));
      const inv = invoices.find((i) => i.id === id);
      if (inv) addEvent(inv.containerId, "Export Manager", "INVOICE_REVIEW", `Invoice ${inv.invoiceNumber} moved to Review`);
    },
    [invoices, addEvent]
  );

  const finalizeInvoice = useCallback(
    (id: string, actorName: string) => {
      setInvoices((xs) =>
        xs.map((i) => {
          if (i.id !== id) return i;
          const consignee = consigneesState.find((c) => c.id === i.consigneeId) || null;
          return { ...i, status: "Finalized", finalizedAt: new Date().toISOString(), needsReview: [], consigneeSnapshot: consignee };
        })
      );
      const inv = invoices.find((i) => i.id === id);
      if (inv) addEvent(inv.containerId, actorName, "INVOICE_FINALIZED", `Invoice ${inv.invoiceNumber} finalized`);
    },
    [invoices, consigneesState, addEvent]
  );

  const reviseFinalizedInvoice = useCallback(
    (id: string, newItems: ExportLine[], reason: string, actorName: string) => {
      setInvoices((xs) =>
        xs.map((i) => {
          if (i.id !== id) return i;
          const revision = { id: nextId("rev"), savedAt: new Date().toISOString(), savedBy: actorName, reason, items: i.items, consigneeSnapshot: i.consigneeSnapshot };
          return { ...i, items: newItems, revisions: [revision, ...i.revisions] };
        })
      );
      const inv = invoices.find((i) => i.id === id);
      if (inv) addEvent(inv.containerId, actorName, "INVOICE_REVISED", `Invoice ${inv.invoiceNumber} corrected after finalization — ${reason}`);
    },
    [invoices, addEvent]
  );

  const addPayment = useCallback(
    (
      invoiceId: string,
      input: { date: string; amount: number; type: ExportPayment["type"]; method: ExportPayment["method"]; referenceNumber: string; notes: string; proofFilename: string | null },
      actorName: string,
      overrideReason?: string
    ) => {
      const inv = invoices.find((i) => i.id === invoiceId);
      if (!inv) return { ok: false, error: "Invoice not found" };
      const total = invoiceTotal(inv.items);
      const existing = paymentsTotal(payments.filter((p) => p.invoiceId === invoiceId));
      const remaining = total - existing;
      if (input.amount > remaining && !overrideReason) {
        return { ok: false, error: `Amount exceeds remaining balance of ${remaining.toFixed(2)}. An authorized override reason is required to exceed it.` };
      }
      setPayments((xs) => [
        ...xs,
        {
          id: nextId("pay"),
          invoiceId,
          date: input.date,
          amount: input.amount,
          type: input.type,
          method: input.method,
          referenceNumber: input.referenceNumber,
          notes: overrideReason ? `${input.notes ? input.notes + " — " : ""}Override: ${overrideReason}` : input.notes,
          proofFilename: input.proofFilename,
          enteredBy: actorName,
          createdAt: new Date().toISOString(),
          correction: null,
        },
      ]);
      addEvent(inv.containerId, actorName, "PAYMENT_ADDED", `${input.type} of ${input.amount} (${input.method}) recorded on invoice ${inv.invoiceNumber}`);
      return { ok: true };
    },
    [invoices, payments, addEvent]
  );

  const correctPayment = useCallback(
    (paymentId: string, newAmount: number, reason: string, actorName: string) => {
      setPayments((xs) =>
        xs.map((p) =>
          p.id === paymentId
            ? { ...p, amount: newAmount, correction: { originalAmount: p.correction?.originalAmount ?? p.amount, reason, correctedBy: actorName, correctedAt: new Date().toISOString() } }
            : p
        )
      );
      const payment = payments.find((p) => p.id === paymentId);
      const inv = payment ? invoices.find((i) => i.id === payment.invoiceId) : undefined;
      if (inv) addEvent(inv.containerId, actorName, "PAYMENT_CORRECTED", `Payment corrected — ${reason}`);
    },
    [payments, invoices, addEvent]
  );

  const markOnTheWay = useCallback(
    (containerId: string, input: { shipDate: string; eta: string; note: string }, actorName: string) => {
      setJobs((xs) =>
        xs.map((j) => (j.id === containerId ? { ...j, status: "on_the_way", shipDate: input.shipDate || j.shipDate, eta: input.eta || j.eta, shippingNote: input.note, lastUpdateAt: new Date().toISOString() } : j))
      );
      addEvent(containerId, actorName, "ON_THE_WAY", "Marked On the Way");
    },
    [addEvent]
  );

  const closeContainer = useCallback(
    (containerId: string, actorName: string, overrideReason?: string): CloseResult => {
      const job = jobs.find((j) => j.id === containerId);
      if (!job) return { ok: false, reason: "Container not found" };
      const inv = invoices.find((i) => i.containerId === containerId);
      const total = inv ? invoiceTotal(inv.items) : 0;
      const paid = inv ? paymentsTotal(payments.filter((p) => p.invoiceId === inv.id)) : 0;
      const balance = total - paid;
      if (balance !== 0 && !overrideReason) {
        return { ok: false, reason: `Balance of ${balance.toFixed(2)} is outstanding. An authorized override reason is required to close with a balance.` };
      }
      setJobs((xs) => xs.map((j) => (j.id === containerId ? { ...j, status: "closed", closedAt: new Date().toISOString(), closedByName: actorName, closeOverrideReason: overrideReason || null } : j)));
      addEvent(containerId, actorName, "CLOSED", overrideReason ? `Container closed with override — ${overrideReason}` : "Container closed");
      return { ok: true };
    },
    [jobs, invoices, payments, addEvent]
  );

  const reopenContainer = useCallback(
    (containerId: string, actorName: string, reason: string) => {
      setJobs((xs) => xs.map((j) => (j.id === containerId ? { ...j, status: "on_the_way", closedAt: null, closedByName: null, closeOverrideReason: null } : j)));
      addEvent(containerId, actorName, "REOPENED", `Container reopened — ${reason}`);
    },
    [addEvent]
  );

  const value: ContainersDataValue = {
    jobs,
    loaderJobs,
    invoices,
    payments,
    consignees: consigneesState,
    getJob,
    getInvoiceForContainer,
    getPaymentsForInvoice,
    getConsignee,
    createJob,
    updateJobMeta,
    confirmContainerNumber,
    addFile,
    markLoadingFinished,
    addConsignee,
    updateConsignee,
    runLoadingListDraft,
    createInvoice,
    updateInvoiceMeta,
    setInvoiceItems,
    moveInvoiceToReview,
    finalizeInvoice,
    reviseFinalizedInvoice,
    addPayment,
    correctPayment,
    markOnTheWay,
    closeContainer,
    reopenContainer,
    addEvent,
  };

  return <ContainersDataContext.Provider value={value}>{children}</ContainersDataContext.Provider>;
}

export function useContainersData() {
  const ctx = useContext(ContainersDataContext);
  if (!ctx) throw new Error("useContainersData must be used within ContainersDataProvider");
  return ctx;
}

export type { ContainerStatus };
