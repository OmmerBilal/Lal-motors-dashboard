"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSalesData } from "@/components/sales/sales-data-context";

export function SettingsView({ manager }: { manager: boolean }) {
  const { settings, updateSettings } = useSalesData();
  const [form, setForm] = useState({
    taxRate: String(settings.taxRate),
    taxLabel: settings.taxLabel,
    businessName: settings.businessName,
    businessAddress: settings.businessAddress,
    businessPhone: settings.businessPhone,
  });

  function save() {
    updateSettings({
      taxRate: Number(form.taxRate),
      taxLabel: form.taxLabel,
      businessName: form.businessName,
      businessAddress: form.businessAddress,
      businessPhone: form.businessPhone,
    });
    toast.success("Sales settings saved");
  }

  return (
    <div className="max-w-xl space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Configurable Sales Tax & Invoice Settings</h3>
        <p className="text-xs text-muted-foreground">Applied to new quotes; tax-exempt customers remain at 0%.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Tax rate %</Label>
        <Input type="number" step="0.01" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Tax label</Label>
        <Input value={form.taxLabel} onChange={(e) => setForm({ ...form, taxLabel: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Business name</Label>
        <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Business address</Label>
        <Input value={form.businessAddress} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Business phone</Label>
        <Input value={form.businessPhone} onChange={(e) => setForm({ ...form, businessPhone: e.target.value })} />
      </div>
      <Button disabled={!manager} onClick={save}>
        Save Settings
      </Button>
    </div>
  );
}
