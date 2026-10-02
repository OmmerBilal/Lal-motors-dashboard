"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  scrapLoads as seedLoads,
  scrapPayments as seedPayments,
  rimObligations as seedRimObligations,
  scrapAuditEvents as seedAudit,
  dailyCloses as seedDailyCloses,
  driverCheckSubmissions as seedCheckSubmissions,
  scrapDrivers,
  localDay,
  loadAmount,
  paymentExpectedTotal,
  paymentIsMismatched,
  effectiveLoadStatus,
  type ScrapLoad,
  type ScrapPayment,
  type RimObligation,
  type RimReturn,
  type ScrapAuditEvent,
  type DailyCloseRecord,
  type PaymentMethod,
  type ScrapPhoto,
  type DriverCheckSubmission,
} from "@/lib/mock/scrap";

function newPhoto(): ScrapPhoto {
  return { id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, takenAt: new Date().toISOString() };
}

type NewPaymentInput = {
  driverId: string;
  driverName: string;
  linkedLoadIds: string[];
  paymentDate: string;
  amountReceived: number;
  method: PaymentMethod;
  referenceNumber: string;
  notes: string;
  enteredByName: string;
  withProofPhoto?: boolean;
  fromCheckSubmissionId?: string;
};

type NewRimObligationInput = {
  customerId: string;
  tiresQty: number;
  aluminumOwed: number;
  steelOwed: number;
  employeeName: string;
  notes: string;
};

type ScrapDataValue = {
  loads: ScrapLoad[];
  payments: ScrapPayment[];
  rimObligations: RimObligation[];
  auditEvents: ScrapAuditEvent[];
  dailyCloses: DailyCloseRecord[];
  checkSubmissions: DriverCheckSubmission[];
  drivers: { id: string; name: string }[];

  createLoad: (driverId: string, driverName: string) => ScrapLoad;
  addTicketPhoto: (loadId: string) => void;
  submitCheckPhoto: (driverId: string, driverName: string) => void;
  saveLoadReview: (loadId: string, input: { weight: number | null; rate: number | null; amountOverride: number | null; managerNotes: string }, actorName: string) => void;
  approveLoad: (loadId: string, actorName: string) => void;

  recordPayment: (input: NewPaymentInput) => ScrapPayment;
  resolveMismatch: (paymentId: string, reason: string, approvedByName: string) => void;

  createRimObligation: (input: NewRimObligationInput) => RimObligation;
  recordRimReturn: (obligationId: string, input: { aluminumReturned: number; steelReturned: number; notes: string; employeeName: string }) => void;

  performDailyClose: (input: { date: string; closedByName: string; overrideReason?: string }) => { ok: boolean; reason?: string };
};

const ScrapDataContext = createContext<ScrapDataValue | null>(null);

export function ScrapDataProvider({ children }: { children: React.ReactNode }) {
  const [loads, setLoads] = useState<ScrapLoad[]>(seedLoads);
  const [payments, setPayments] = useState<ScrapPayment[]>(seedPayments);
  const [rimObligations, setRimObligations] = useState<RimObligation[]>(seedRimObligations);
  const [auditEvents, setAuditEvents] = useState<ScrapAuditEvent[]>(seedAudit);
  const [dailyCloses, setDailyCloses] = useState<DailyCloseRecord[]>(seedDailyCloses);
  const [checkSubmissions, setCheckSubmissions] = useState<DriverCheckSubmission[]>(seedCheckSubmissions);

  const log = useCallback((actorName: string, action: string, summary: string) => {
    setAuditEvents((xs) => [{ id: `sa-${Date.now()}`, createdAt: new Date().toISOString(), actorName, action, summary }, ...xs]);
  }, []);

  const createLoad = useCallback((driverId: string, driverName: string) => {
    const load: ScrapLoad = {
      id: `scrap-${Date.now()}`,
      driverId,
      driverName,
      loadDate: localDay(),
      createdAt: new Date().toISOString(),
      loadPhoto: newPhoto(),
      ticketPhoto: null,
      status: "new",
      weight: null,
      rate: null,
      amount: null,
      managerNotes: "",
      paymentId: null,
    };
    setLoads((xs) => [load, ...xs]);
    log(driverName, "LOAD_CREATED", "New scrap load photo saved");
    return load;
  }, [log]);

  const addTicketPhoto = useCallback(
    (loadId: string) => {
      setLoads((xs) =>
        xs.map((l) => (l.id === loadId ? { ...l, ticketPhoto: newPhoto(), status: l.status === "new" ? "ready_for_review" : l.status } : l))
      );
      const driverName = loads.find((l) => l.id === loadId)?.driverName ?? "Driver";
      log(driverName, "TICKET_UPLOADED", "Ticket photo added to load");
    },
    [log, loads]
  );

  const saveLoadReview = useCallback(
    (loadId: string, input: { weight: number | null; rate: number | null; amountOverride: number | null; managerNotes: string }, actorName: string) => {
      setLoads((xs) =>
        xs.map((l) => {
          if (l.id !== loadId) return l;
          const weight = input.weight;
          const rate = input.rate;
          const amount = input.amountOverride ?? (weight != null && rate != null ? Math.round(weight * rate * 100) / 100 : l.amount);
          return { ...l, weight, rate, amount, managerNotes: input.managerNotes };
        })
      );
      log(actorName, "LOAD_UPDATED", "Weight, rate and amount recorded for load");
    },
    [log]
  );

  const approveLoad = useCallback(
    (loadId: string, actorName: string) => {
      setLoads((xs) => xs.map((l) => (l.id === loadId ? { ...l, status: "approved" } : l)));
      log(actorName, "LOAD_APPROVED", "Load approved");
    },
    [log]
  );

  const submitCheckPhoto = useCallback(
    (driverId: string, driverName: string) => {
      setCheckSubmissions((xs) => [
        { id: `chk-sub-${Date.now()}`, driverId, driverName, photo: newPhoto(), createdAt: new Date().toISOString(), linkedPaymentId: null },
        ...xs,
      ]);
      log(driverName, "CHECK_SUBMITTED", "Photographed end-of-day check");
    },
    [log]
  );

  const recordPayment = useCallback(
    (input: NewPaymentInput) => {
      const payment: ScrapPayment = {
        id: `pay-${Date.now()}`,
        driverId: input.driverId,
        driverName: input.driverName,
        linkedLoadIds: input.linkedLoadIds,
        paymentDate: input.paymentDate,
        amountReceived: input.amountReceived,
        method: input.method,
        referenceNumber: input.referenceNumber,
        proofPhoto: input.withProofPhoto ? newPhoto() : null,
        notes: input.notes,
        enteredByName: input.enteredByName,
        createdAt: new Date().toISOString(),
        discrepancyReason: null,
        discrepancyApprovedBy: null,
      };
      setPayments((xs) => [payment, ...xs]);
      setLoads((xs) => {
        const expected = paymentExpectedTotal(payment, xs);
        const mismatched = Math.abs(expected - payment.amountReceived) > 0.01;
        return xs.map((l) =>
          input.linkedLoadIds.includes(l.id) ? { ...l, paymentId: payment.id, status: mismatched ? "approved" : "closed" } : l
        );
      });
      if (input.fromCheckSubmissionId) {
        setCheckSubmissions((xs) => xs.map((c) => (c.id === input.fromCheckSubmissionId ? { ...c, linkedPaymentId: payment.id } : c)));
      }
      log(input.enteredByName, "PAYMENT_LINKED", `Linked ${input.method} payment to ${input.linkedLoadIds.length} load(s)`);
      return payment;
    },
    [log]
  );

  const resolveMismatch = useCallback(
    (paymentId: string, reason: string, approvedByName: string) => {
      setPayments((xs) => xs.map((p) => (p.id === paymentId ? { ...p, discrepancyReason: reason, discrepancyApprovedBy: approvedByName } : p)));
      setLoads((xs) => {
        const payment = payments.find((p) => p.id === paymentId);
        if (!payment) return xs;
        return xs.map((l) => (payment.linkedLoadIds.includes(l.id) ? { ...l, status: "closed" } : l));
      });
      log(approvedByName, "PAYMENT_DISCREPANCY_RESOLVED", `Payment mismatch approved: ${reason}`);
    },
    [log, payments]
  );

  const createRimObligation = useCallback(
    (input: NewRimObligationInput) => {
      const obligation: RimObligation = {
        id: `rim-${Date.now()}`,
        customerId: input.customerId,
        tiresQty: input.tiresQty,
        aluminumOwed: input.aluminumOwed,
        steelOwed: input.steelOwed,
        pickupPhoto: newPhoto(),
        employeeName: input.employeeName,
        createdAt: new Date().toISOString(),
        notes: input.notes,
        returns: [],
      };
      setRimObligations((xs) => [obligation, ...xs]);
      log(input.employeeName, "RIM_OBLIGATION_CREATED", `Recorded rim obligation: ${input.aluminumOwed} aluminum / ${input.steelOwed} steel`);
      return obligation;
    },
    [log]
  );

  const recordRimReturn = useCallback(
    (obligationId: string, input: { aluminumReturned: number; steelReturned: number; notes: string; employeeName: string }) => {
      const ret: RimReturn = {
        id: `rimret-${Date.now()}`,
        aluminumReturned: Math.max(0, input.aluminumReturned),
        steelReturned: Math.max(0, input.steelReturned),
        photo: newPhoto(),
        notes: input.notes,
        employeeName: input.employeeName,
        createdAt: new Date().toISOString(),
      };
      setRimObligations((xs) =>
        xs.map((o) => {
          if (o.id !== obligationId) return o;
          const returnedAl = o.returns.reduce((n, r) => n + r.aluminumReturned, 0);
          const returnedSteel = o.returns.reduce((n, r) => n + r.steelReturned, 0);
          const remainingAl = Math.max(0, o.aluminumOwed - returnedAl);
          const remainingSteel = Math.max(0, o.steelOwed - returnedSteel);
          const clamped: RimReturn = {
            ...ret,
            aluminumReturned: Math.min(ret.aluminumReturned, remainingAl),
            steelReturned: Math.min(ret.steelReturned, remainingSteel),
          };
          return { ...o, returns: [...o.returns, clamped] };
        })
      );
      log(input.employeeName, "RIM_RETURN", `Recorded rim return — ${input.aluminumReturned} aluminum / ${input.steelReturned} steel`);
    },
    [log]
  );

  const performDailyClose = useCallback(
    (input: { date: string; closedByName: string; overrideReason?: string }) => {
      const dayLoads = loads.filter((l) => l.loadDate === input.date);
      const missingEvidence = dayLoads.filter((l) => effectiveLoadStatus(l) === "ticket_missing" || !l.loadPhoto);
      const unresolvedMismatches = payments.filter(
        (p) => p.linkedLoadIds.some((id) => dayLoads.some((l) => l.id === id)) && paymentIsMismatched(p, loads)
      );
      if ((missingEvidence.length || unresolvedMismatches.length) && !input.overrideReason) {
        return {
          ok: false,
          reason: `${missingEvidence.length} load(s) missing evidence, ${unresolvedMismatches.length} unresolved payment mismatch(es). Provide an override reason to close anyway.`,
        };
      }
      const record: DailyCloseRecord = {
        id: `close-${Date.now()}`,
        date: input.date,
        closedByName: input.closedByName,
        closedAt: new Date().toISOString(),
        overrideReason: input.overrideReason || null,
        totals: {
          loads: dayLoads.length,
          approvedLoads: dayLoads.filter((l) => l.status === "approved" || l.status === "closed").length,
          weight: dayLoads.reduce((n, l) => n + (l.weight || 0), 0),
          amount: dayLoads.reduce((n, l) => n + loadAmount(l), 0),
          paymentsReceived: payments.filter((p) => p.paymentDate === input.date).reduce((n, p) => n + p.amountReceived, 0),
        },
      };
      setDailyCloses((xs) => [record, ...xs]);
      log(input.closedByName, "DAILY_CLOSE", `Closed ${input.date}${input.overrideReason ? " (override: " + input.overrideReason + ")" : ""}`);
      return { ok: true };
    },
    [loads, payments, log]
  );

  const value: ScrapDataValue = {
    loads,
    payments,
    rimObligations,
    auditEvents,
    dailyCloses,
    checkSubmissions,
    drivers: scrapDrivers,
    createLoad,
    addTicketPhoto,
    submitCheckPhoto,
    saveLoadReview,
    approveLoad,
    recordPayment,
    resolveMismatch,
    createRimObligation,
    recordRimReturn,
    performDailyClose,
  };

  return <ScrapDataContext.Provider value={value}>{children}</ScrapDataContext.Provider>;
}

export function useScrapData() {
  const ctx = useContext(ScrapDataContext);
  if (!ctx) throw new Error("useScrapData must be used within ScrapDataProvider");
  return ctx;
}
