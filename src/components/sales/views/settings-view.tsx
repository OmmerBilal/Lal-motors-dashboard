"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSalesSettings, useUpdateSalesSettings } from "@/lib/query/sales";
import type { SalesSettings } from "@/lib/data/sales";

type Form = { taxRate: string; taxLabel: string; businessName: string; businessAddress: string; businessPhone: string };

/** Owner and engineer admin can save. The database enforces the same rule through the settings write policy. */
export function SettingsView({ manager }: { manager: boolean }) {
  const settingsQuery = useSalesSettings();
  if (settingsQuery.isPending) return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  if (settingsQuery.isError) return <p className="text-sm text-destructive">{settingsQuery.error.message}</p>;
  const saved = settingsQuery.data;
  if (!saved) return <p className="text-sm text-muted-foreground">No sales settings row exists yet. Tax is 0% until one is saved.</p>;
  // Keyed on the saved values: after a save the query refreshes and the form reloads from the database.
  return <SettingsForm key={JSON.stringify(saved)} saved={saved} manager={manager} />;
}

function SettingsForm({ saved, manager }: { saved: SalesSettings; manager: boolean }) {
  const update = useUpdateSalesSettings();
  const [form, setForm] = useState<Form>({
    taxRate: String(saved.taxRate),
    taxLabel: saved.taxLabel,
    businessName: saved.businessName,
    businessAddress: saved.businessAddress,
    businessPhone: saved.businessPhone,
  });

  async function save() {
    const rate = Number(form.taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Tax rate must be between 0 and 100.");
      return;
    }
    try {
      await update.mutateAsync({
        taxRate: rate,
        taxLabel: form.taxLabel,
        businessName: form.businessName,
        businessAddress: form.businessAddress,
        businessPhone: form.businessPhone,
      });
      toast.success("Sales settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The settings were not saved.");
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Configurable Sales Tax & Invoice Settings</h3>
        <p className="text-xs text-muted-foreground">Applied to new sales and quotes. Customer tax exemption is not applied by the server yet.</p>
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
      <Button disabled={!manager || update.isPending} onClick={save}>
        {update.isPending ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}
