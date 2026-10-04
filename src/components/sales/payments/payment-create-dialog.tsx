"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePayment } from "@/lib/query/payments";
import { useCustomerList } from "@/lib/query/customers";
import { listRowToCustomer } from "@/lib/data/customers";
import { usd, type Customer, type PaymentMethod } from "@/lib/mock/sales";
import { salesErrorMessage } from "@/lib/data/sales";

const methods: { id: PaymentMethod; label: string }[] = [
  { id: "CASH", label: "Cash" },
  { id: "CARD", label: "Card" },
  { id: "CHECK", label: "Check" },
  { id: "BANK_TRANSFER", label: "Bank transfer" },
  { id: "QR_CODE", label: "QR code" },
  { id: "PAYMENT_LINK", label: "Payment link" },
  { id: "OTHER", label: "Other" },
];

/** Amount text as typed. The database validates the value and stores it as NUMERIC. */
const AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Creates a PENDING payment. Nothing changes on any sale until the payment is allocated and posted.
 * Success is shown only after create_payment returns.
 */
export function PaymentCreateDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string | null;
  customerName: string;
  onCreated: (paymentId: string) => void;
}) {
  const create = useCreatePayment();
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const customers = useCustomerList(customerQuery.trim());
  const matches = customerQuery.trim() ? (customers.data?.pages[0]?.rows ?? []).slice(0, 6).map(listRowToCustomer) : [];
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // The idempotency key is reused for a retry of the same payload. A changed payload gets a new key.
  const [keyedPayload, setKeyedPayload] = useState("");
  const [error, setError] = useState("");

  const effectiveCustomerId = customerId ?? pickedCustomer?.id ?? null;
  const effectiveName = customerId ? customerName : pickedCustomer ? pickedCustomer.firstName : "";

  async function submit() {
    setError("");
    if (!effectiveCustomerId) return setError("Select a customer.");
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) return setError("Enter an amount greater than zero, up to two decimals.");
    const payloadKey = JSON.stringify([effectiveCustomerId, amount, method, reference.trim(), notes.trim()]);
    let key = requestId;
    if (payloadKey !== keyedPayload) {
      key = crypto.randomUUID();
      setRequestId(key);
      setKeyedPayload(payloadKey);
    }
    try {
      const r = await create.mutateAsync({ customerId: effectiveCustomerId, amount, method, reference: reference.trim(), notes: notes.trim(), clientRequestId: key });
      toast.success(`Payment of ${usd(amount)} saved as pending`);
      setAmount("");
      setReference("");
      setNotes("");
      setPickedCustomer(null);
      setCustomerQuery("");
      setRequestId(crypto.randomUUID());
      setKeyedPayload("");
      onOpenChange(false);
      onCreated(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : salesErrorMessage(null));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {customerId ? (
            <p className="text-sm">
              Customer: <b>{customerName}</b>
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Customer</Label>
              {pickedCustomer ? (
                <p className="text-sm">
                  <b>{pickedCustomer.firstName}</b> <Button variant="ghost" size="sm" onClick={() => setPickedCustomer(null)}>Change</Button>
                </p>
              ) : (
                <>
                  <Input placeholder="Search customer by name or phone" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
                  {matches.map((c) => (
                    <button key={c.id} onClick={() => setPickedCustomer(c)} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent/40">
                      {c.firstName} · {c.customerNumber}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount ($)</Label>
              <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? "CASH")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reference (no card numbers)</Label>
            <Input maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea maxLength={2000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {effectiveName && !customerId && <p className="text-xs text-muted-foreground">Selected: {effectiveName}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">The payment is saved as pending. It does not change any sale until it is allocated and posted.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending || !effectiveCustomerId} onClick={submit}>
            {create.isPending ? "Saving…" : "Save pending payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
