"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  customers as seedCustomers,
  quotes as seedQuotes,
  sales as seedSales,
  payments as seedPayments,
  salesSettings as seedSettings,
  emptyCustomer,
  type Customer,
  type Quote,
  type QuoteStatus,
  type SaleItem,
  type SaleRecord,
  type Payment,
} from "@/lib/mock/sales";
import { returns as seedReturns, type ReturnRecord, type ReturnDisposition, type ReturnReason } from "@/lib/mock/pos";

let customerSeq = 1004;
let quoteSeq = 2202;
let saleSeq = 3302;
let paymentSeq = 9002;
let returnSeq = 7701;

type NewCustomer = typeof emptyCustomer;

type SalesDataValue = {
  customers: Customer[];
  quotes: Quote[];
  sales: SaleRecord[];
  payments: Payment[];
  settings: typeof seedSettings;
  getCustomer: (id: string) => Customer | undefined;
  getQuote: (id: string) => Quote | undefined;
  getSale: (id: string) => SaleRecord | undefined;
  findDuplicates: (phone: string) => Customer[];
  saveCustomer: (id: string | null, form: NewCustomer) => string;
  addDocument: (customerId: string, filename: string, type: string) => void;
  createQuote: (customerId: string, items: SaleItem[], notes: string) => string;
  updateQuoteItems: (id: string, items: SaleItem[]) => void;
  setQuoteStatus: (id: string, status: QuoteStatus) => void;
  convertQuote: (id: string) => string;
  directSale: (customerId: string, items: SaleItem[]) => string;
  completePosSale: (input: {
    customerId: string;
    items: SaleItem[];
    discount: number;
    coreCharge: number;
    depositApplied: number;
    notes: string;
    taxExempt: boolean;
  }) => string;
  recordPayment: (saleId: string, amount: number, method: Payment["method"], reference: string, notes: string) => void;
  updateSettings: (s: Partial<typeof seedSettings>) => void;
  returns: ReturnRecord[];
  processReturn: (input: {
    saleId: string;
    itemDescription: string;
    reason: ReturnReason;
    disposition: ReturnDisposition;
    refundMethod: Payment["method"];
    refundAmount: number;
  }) => string;
};

const SalesDataContext = createContext<SalesDataValue | null>(null);

export function SalesDataProvider({ children }: { children: React.ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>(seedCustomers);
  const [quotes, setQuotes] = useState<Quote[]>(seedQuotes);
  const [sales, setSales] = useState<SaleRecord[]>(seedSales);
  const [payments, setPayments] = useState<Payment[]>(seedPayments);
  const [settings, setSettings] = useState(seedSettings);
  const [returns, setReturns] = useState<ReturnRecord[]>(seedReturns);

  const getCustomer = useCallback((id: string) => customers.find((c) => c.id === id), [customers]);
  const getQuote = useCallback((id: string) => quotes.find((q) => q.id === id), [quotes]);
  const getSale = useCallback((id: string) => sales.find((s) => s.id === id), [sales]);

  const findDuplicates = useCallback(
    (phone: string) => {
      const normalized = phone.replace(/\D/g, "");
      if (normalized.length < 7) return [];
      return customers.filter((c) => c.phone.replace(/\D/g, "") === normalized);
    },
    [customers]
  );

  const saveCustomer = useCallback((id: string | null, form: NewCustomer) => {
    if (id) {
      setCustomers((xs) => xs.map((c) => (c.id === id ? { ...c, ...form } : c)));
      return id;
    }
    const newId = `cust-${Date.now()}`;
    const number = `CU-${customerSeq++}`;
    setCustomers((xs) => [{ id: newId, customerNumber: number, ...form, documents: [], createdAt: new Date().toISOString() }, ...xs]);
    return newId;
  }, []);

  const addDocument = useCallback((customerId: string, filename: string, type: string) => {
    setCustomers((xs) =>
      xs.map((c) => (c.id === customerId ? { ...c, documents: [...c.documents, { id: `doc-${Date.now()}`, filename, type }] } : c))
    );
  }, []);

  const createQuote = useCallback(
    (customerId: string, items: SaleItem[], notes: string) => {
      const id = `quote-${Date.now()}`;
      const number = `Q-${quoteSeq++}`;
      const customer = customers.find((c) => c.id === customerId);
      setQuotes((xs) => [
        { id, quoteNumber: number, customerId, status: "DRAFT", items, discount: 0, notes, taxRate: customer?.taxStatus === "exempt" ? 0 : settings.taxRate, createdAt: new Date().toISOString() },
        ...xs,
      ]);
      return id;
    },
    [customers, settings.taxRate]
  );

  const updateQuoteItems = useCallback((id: string, items: SaleItem[]) => {
    setQuotes((xs) => xs.map((q) => (q.id === id ? { ...q, items } : q)));
  }, []);

  const setQuoteStatus = useCallback((id: string, status: QuoteStatus) => {
    setQuotes((xs) => xs.map((q) => (q.id === id ? { ...q, status } : q)));
  }, []);

  const createSaleFromItems = useCallback((customerId: string, items: SaleItem[], taxRate: number) => {
    const id = `sale-${Date.now()}`;
    const number = `S-${saleSeq}`;
    const invoice = `INV-${saleSeq}`;
    saleSeq++;
    setSales((xs) => [{ id, saleNumber: number, invoiceNumber: invoice, customerId, items, discount: 0, taxRate, createdAt: new Date().toISOString() }, ...xs]);
    return id;
  }, []);

  const convertQuote = useCallback(
    (id: string) => {
      const quote = quotes.find((q) => q.id === id);
      if (!quote) return "";
      const saleId = createSaleFromItems(quote.customerId, quote.items, quote.taxRate);
      setQuotes((xs) => xs.map((q) => (q.id === id ? { ...q, status: "CONVERTED" } : q)));
      return saleId;
    },
    [quotes, createSaleFromItems]
  );

  const directSale = useCallback(
    (customerId: string, items: SaleItem[]) => {
      const customer = customers.find((c) => c.id === customerId);
      return createSaleFromItems(customerId, items, customer?.taxStatus === "exempt" ? 0 : settings.taxRate);
    },
    [customers, settings.taxRate, createSaleFromItems]
  );

  const completePosSale = useCallback(
    (input: { customerId: string; items: SaleItem[]; discount: number; coreCharge: number; depositApplied: number; notes: string; taxExempt: boolean }) => {
      const id = `sale-${Date.now()}`;
      const number = `S-${saleSeq}`;
      const invoice = `INV-${saleSeq}`;
      saleSeq++;
      setSales((xs) => [
        {
          id,
          saleNumber: number,
          invoiceNumber: invoice,
          customerId: input.customerId,
          items: input.items,
          discount: input.discount,
          taxRate: input.taxExempt ? 0 : settings.taxRate,
          createdAt: new Date().toISOString(),
          coreCharge: input.coreCharge,
          depositApplied: input.depositApplied,
          notes: input.notes,
        },
        ...xs,
      ]);
      return id;
    },
    [settings.taxRate]
  );

  const processReturn = useCallback(
    (input: {
      saleId: string;
      itemDescription: string;
      reason: ReturnReason;
      disposition: ReturnDisposition;
      refundMethod: Payment["method"];
      refundAmount: number;
    }) => {
      const id = `return-${Date.now()}`;
      const number = `RMA-${returnSeq++}`;
      const sale = sales.find((s) => s.id === input.saleId);
      setReturns((xs) => [
        {
          id,
          returnNumber: number,
          saleId: input.saleId,
          saleNumber: sale?.saleNumber || "",
          itemDescription: input.itemDescription,
          reason: input.reason,
          disposition: input.disposition,
          refundMethod: input.refundMethod,
          refundAmount: input.refundAmount,
          status: "processed",
          createdAt: new Date().toISOString(),
        },
        ...xs,
      ]);
      return id;
    },
    [sales]
  );

  const recordPayment = useCallback((saleId: string, amount: number, method: Payment["method"], reference: string, notes: string) => {
    const number = `P-${paymentSeq++}`;
    setPayments((xs) => [{ id: `pay-${Date.now()}`, paymentNumber: number, saleId, amount, method, reference, notes, createdAt: new Date().toISOString() }, ...xs]);
  }, []);

  const updateSettings = useCallback((s: Partial<typeof seedSettings>) => {
    setSettings((prev) => ({ ...prev, ...s }));
  }, []);

  const value: SalesDataValue = {
    customers,
    quotes,
    sales,
    payments,
    settings,
    getCustomer,
    getQuote,
    getSale,
    findDuplicates,
    saveCustomer,
    addDocument,
    createQuote,
    updateQuoteItems,
    setQuoteStatus,
    convertQuote,
    directSale,
    completePosSale,
    recordPayment,
    updateSettings,
    returns,
    processReturn,
  };

  return <SalesDataContext.Provider value={value}>{children}</SalesDataContext.Provider>;
}

export function useSalesData() {
  const ctx = useContext(SalesDataContext);
  if (!ctx) throw new Error("useSalesData must be used within SalesDataProvider");
  return ctx;
}
