"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSalesData } from "@/components/sales/sales-data-context";
import { returnDispositionLabels, returnReasonLabels, type ReturnDisposition, type ReturnReason } from "@/lib/mock/pos";
import type { Payment } from "@/lib/mock/sales";

export function ReturnsPanel() {
  const { sales, processReturn } = useSalesData();
  const [open, setOpen] = useState(false);
  const [saleQuery, setSaleQuery] = useState("");
  const [saleId, setSaleId] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [reason, setReason] = useState<ReturnReason>("defective");
  const [disposition, setDisposition] = useState<ReturnDisposition>("restock");
  const [refundMethod, setRefundMethod] = useState<Payment["method"]>("CASH");
  const [refundAmount, setRefundAmount] = useState("");

  const matchingSale = sales.find((s) => s.id === saleId);
  const matches = saleQuery.trim() ? sales.filter((s) => s.saleNumber.toLowerCase().includes(saleQuery.trim().toLowerCase())).slice(0, 5) : [];

  function reset() {
    setSaleQuery("");
    setSaleId("");
    setItemDescription("");
    setReason("defective");
    setDisposition("restock");
    setRefundMethod("CASH");
    setRefundAmount("");
  }

  function submit() {
    const amount = Number(refundAmount);
    if (!saleId || !itemDescription.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Select the original sale, item, and a valid refund amount.");
      return;
    }
    processReturn({ saleId, itemDescription: itemDescription.trim(), reason, disposition, refundMethod, refundAmount: amount });
    toast.success("Return processed (mock refund — no real payment reversed)");
    setOpen(false);
    reset();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-left shadow-xs transition-colors hover:border-destructive/45 hover:bg-destructive/15"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <RotateCcw className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1 text-xs leading-tight font-semibold text-destructive">
          Returns
          <br />
          Refunds
        </span>
        <ChevronRight className="size-4 shrink-0 text-destructive/60" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Process a return</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Search original invoice</Label>
              <Input placeholder="Sale # e.g. S-3301" value={saleQuery} onChange={(e) => setSaleQuery(e.target.value)} />
              {matches.length > 0 && (
                <div className="space-y-0.5 rounded-md border border-border p-1">
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSaleId(s.id);
                        setSaleQuery(s.saleNumber);
                      }}
                      className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent/40"
                    >
                      {s.saleNumber} · {s.items.length} item(s)
                    </button>
                  ))}
                </div>
              )}
              {matchingSale && <p className="text-xs text-muted-foreground">Selected: {matchingSale.saleNumber}</p>}
            </div>

            {matchingSale && (
              <div className="space-y-1.5">
                <Label>Choose item</Label>
                <Select value={itemDescription} onValueChange={(v) => setItemDescription(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select item to return" />
                  </SelectTrigger>
                  <SelectContent>
                    {matchingSale.items.map((i) => (
                      <SelectItem key={i.id} value={i.description}>
                        {i.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Return reason</Label>
                <Select value={reason} onValueChange={(v) => setReason((v as ReturnReason) ?? "defective")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(returnReasonLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Disposition</Label>
                <Select value={disposition} onValueChange={(v) => setDisposition((v as ReturnDisposition) ?? "restock")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(returnDispositionLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Refund method</Label>
                <Select value={refundMethod} onValueChange={(v) => setRefundMethod((v as Payment["method"]) ?? "CASH")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["CASH", "CARD", "CHECK", "BANK_TRANSFER", "OTHER"] as const).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Refund amount ($)</Label>
                <Input type="number" min={0} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>Process Return</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
