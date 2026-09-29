"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerFieldOrder, emptyCustomer, type Customer } from "@/lib/mock/sales";
import { useSalesData } from "@/components/sales/sales-data-context";

function customerToForm(editing: Customer | null, prefill?: Partial<typeof emptyCustomer>) {
  if (!editing) return { ...emptyCustomer, ...prefill };
  return {
    firstName: editing.firstName,
    lastName: editing.lastName,
    companyName: editing.companyName,
    phone: editing.phone,
    secondaryPhone: editing.secondaryPhone,
    email: editing.email,
    billingAddress: editing.billingAddress,
    shippingAddress: editing.shippingAddress,
    notes: editing.notes,
    customerType: editing.customerType,
    taxStatus: editing.taxStatus,
    taxId: editing.taxId,
    resaleCertificateNumber: editing.resaleCertificateNumber,
    exemptionExpiresAt: editing.exemptionExpiresAt,
  };
}

function CustomerModalForm({
  editing,
  manager,
  prefill,
  onClose,
  onSaved,
}: {
  editing: Customer | null;
  manager: boolean;
  prefill?: Partial<typeof emptyCustomer>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { saveCustomer, findDuplicates, addDocument } = useSalesData();
  const [form, setForm] = useState(() => customerToForm(editing, prefill));
  const [docName, setDocName] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);

  function save(override = false) {
    if (!form.firstName.trim() && !form.lastName.trim() && !form.companyName.trim()) {
      setError("Enter a customer name or company before saving.");
      return;
    }
    if (!override && !editing) {
      const dupes = findDuplicates(form.phone);
      if (dupes.length) {
        setDuplicates(dupes);
        return;
      }
    }
    setSaving(true);
    const id = saveCustomer(editing?.id ?? null, form);
    if (docName) addDocument(id, docName, "tax_document");
    setSaving(false);
    toast.success(docName ? "Customer and tax document saved" : "Customer saved");
    onClose();
    onSaved(id);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Update customer" : "Add customer"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        {customerFieldOrder.map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label>{label}</Label>
            <Input value={form[key] as string} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label>Customer type</Label>
          <Select value={form.customerType} onValueChange={(v) => setForm({ ...form, customerType: (v as typeof form.customerType) ?? "retail" })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="retail">Retail</SelectItem>
              <SelectItem value="wholesale">Wholesale</SelectItem>
              <SelectItem value="business">Business</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Tax status</Label>
          <Select value={form.taxStatus} onValueChange={(v) => setForm({ ...form, taxStatus: (v as typeof form.taxStatus) ?? "taxable" })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="taxable">Taxable</SelectItem>
              <SelectItem value="exempt" disabled={!manager}>
                Tax Exempt (manager)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>

      <div className="rounded-md border border-dashed border-border p-3">
        <p className="text-sm font-semibold">Tax ID / resale certificate document</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Attach a PDF or photo to this customer. A scanner can save a PDF or image to your computer for upload.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Upload form", "Scan from scanner / printer", "Take photo"].map((label) => (
            <label key={label} className="cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-primary">
              {label}
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) setDocName(e.target.files[0].name);
                  e.target.value = "";
                }}
              />
            </label>
          ))}
        </div>
        {docName && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span>Selected: {docName}</span>
            <button type="button" className="font-semibold text-destructive" onClick={() => setDocName("")}>
              Remove
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <b className="text-sm">Possible duplicate customer found</b>
          <p className="mt-0.5 text-xs text-muted-foreground">Open the existing customer instead of creating another.</p>
          <div className="mt-2 space-y-1">
            {duplicates.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  onClose();
                  onSaved(d.id);
                }}
                className="block w-full rounded-md bg-background px-2.5 py-1.5 text-left text-sm hover:bg-accent/40"
              >
                {d.customerNumber} · {d.companyName || `${d.firstName} ${d.lastName}`} · {d.phone}
              </button>
            ))}
          </div>
          {manager && (
            <Button variant="destructive" size="sm" className="mt-2" onClick={() => save(true)}>
              Manager: Confirm genuinely different customer
            </Button>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={saving} onClick={() => save(false)}>
          {saving ? "Saving…" : docName ? "Save Customer & Attach" : "Save Customer"}
        </Button>
      </div>
    </>
  );
}

export function CustomerModal({
  open,
  onOpenChange,
  editing,
  manager,
  prefill,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Customer | null;
  manager: boolean;
  prefill?: Partial<typeof emptyCustomer>;
  onSaved: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {open && (
          <CustomerModalForm
            key={editing?.id ?? "new"}
            editing={editing}
            manager={manager}
            prefill={prefill}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
