"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/patterns/empty-state";
import { usd, itemTotals, type Customer, type SaleItem } from "@/lib/mock/sales";
import { parts as allParts } from "@/lib/mock/parts";
import { useSalesData } from "@/components/sales/sales-data-context";

export function DeskView({
  manager,
  selectedCustomer,
  onSelectCustomer,
  onNewCustomer,
  onQuoteCreated,
  onSaleCreated,
}: {
  manager: boolean;
  selectedCustomer: Customer | null;
  onSelectCustomer: (c: Customer | null) => void;
  onNewCustomer: () => void;
  onQuoteCreated: (id: string) => void;
  onSaleCreated: (id: string) => void;
}) {
  const { customers, createQuote, directSale } = useSalesData();
  const [customerQ, setCustomerQ] = useState("");
  const [inventoryQ, setInventoryQ] = useState("");
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [manualItem, setManualItem] = useState({ description: "", quantity: "1", price: "" });
  const [loading, setLoading] = useState(false);

  const matchingCustomers = useMemo(() => {
    if (!customerQ.trim()) return [];
    const q = customerQ.toLowerCase();
    return customers
      .filter((c) => `${c.firstName} ${c.lastName} ${c.companyName} ${c.phone} ${c.email} ${c.customerNumber}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [customers, customerQ]);

  const approvedParts = useMemo(() => allParts.filter((p) => p.status === "approved"), []);
  const matchingParts = useMemo(() => {
    if (!inventoryQ.trim()) return [];
    const q = inventoryQ.toLowerCase();
    return approvedParts.filter((p) =>
      [p.stockSku, p.draft.partNumber, p.draft.partName, p.draft.sourceVin, p.draft.sourceLot, p.draft.location]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [approvedParts, inventoryQ]);

  function addPart(p: (typeof approvedParts)[number]) {
    if (p.operationalStatus !== "AVAILABLE" || p.quantity < 1) return toast.error("This part is unavailable.");
    if (cart.some((x) => x.partId === p.id)) return toast.error("Part already added.");
    setCart((v) => [
      ...v,
      {
        id: `cart-${p.id}`,
        manual: false,
        partId: p.id,
        stockSku: p.stockSku || "",
        description: p.draft.partName || p.draft.title || "Part",
        quantity: 1,
        unitPrice: Number(p.draft.price) || 0,
        discount: 0,
        availableQuantity: p.quantity,
      },
    ]);
    toast.success(`${p.stockSku} added`);
  }

  function addManualItem() {
    const description = manualItem.description.trim();
    const quantity = Number(manualItem.quantity);
    const price = Number(manualItem.price);
    if (!description || !Number.isInteger(quantity) || quantity < 1 || !manualItem.price.trim() || !Number.isFinite(price) || price < 0) {
      toast.error("Enter a description, valid quantity, and unit price for the manual item.");
      return;
    }
    setCart((items) => [
      ...items,
      { id: `manual-${Date.now()}`, manual: true, stockSku: "MANUAL", description, quantity, unitPrice: price, discount: 0 },
    ]);
    setManualItem({ description: "", quantity: "1", price: "" });
  }

  const totals = itemTotals(cart, 0, selectedCustomer?.taxStatus === "exempt" ? 0 : 7.5);

  function saveDraftQuote() {
    if (!selectedCustomer) return toast.error("Select a customer.");
    if (!cart.length) return toast.error("Add an inventory part or a manual item.");
    setLoading(true);
    const id = createQuote(selectedCustomer.id, cart, "Sales Desk quote");
    setCart([]);
    setLoading(false);
    toast.success("Quote saved");
    onQuoteCreated(id);
  }

  function managerDirectSale() {
    if (!manager || !selectedCustomer || !cart.length) return;
    if (!window.confirm("Finalize this direct sale and update inventory now?")) return;
    setLoading(true);
    const id = directSale(selectedCustomer.id, cart);
    setCart([]);
    setLoading(false);
    toast.success("Sale finalized");
    onSaleCreated(id);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">1. Customer</h3>
            <p className="text-xs text-muted-foreground">Search by phone, name, email or company</p>
          </div>
          <Button variant="outline" size="sm" onClick={onNewCustomer}>
            <Plus /> New
          </Button>
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="904-555-1234 or customer name" value={customerQ} onChange={(e) => setCustomerQ(e.target.value)} />
        </div>
        {selectedCustomer ? (
          <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <Check className="size-5 text-primary" />
            <span className="min-w-0 flex-1">
              <b className="block text-sm">{selectedCustomer.companyName || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}</b>
              <small className="text-xs text-muted-foreground">
                {selectedCustomer.phone} · {selectedCustomer.taxStatus === "exempt" ? "TAX EXEMPT" : "TAXABLE"}
              </small>
            </span>
            <Button variant="ghost" size="sm" onClick={() => onSelectCustomer(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {matchingCustomers.map((c) => (
              <button key={c.id} onClick={() => onSelectCustomer(c)} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-accent/40">
                <UserRound className="size-4 text-muted-foreground" />
                <span>
                  <b className="block text-sm">{c.companyName || `${c.firstName} ${c.lastName}`}</b>
                  <small className="text-xs text-muted-foreground">
                    {c.customerNumber} · {c.phone}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">2. Existing Parts Inventory</h3>
        <p className="mb-3 text-xs text-muted-foreground">Search approved parts</p>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="SKU, OEM, part, VIN, Lot, location" value={inventoryQ} onChange={(e) => setInventoryQ(e.target.value)} />
        </div>
        {matchingParts.length ? (
          <div className="space-y-1.5">
            {matchingParts.map((p) => (
              <button
                key={p.id}
                onClick={() => addPart(p)}
                disabled={p.operationalStatus !== "AVAILABLE" || p.quantity < 1}
                className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/30 disabled:opacity-40"
              >
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{p.draft.partName || p.draft.title}</b>
                  <small className="text-xs text-muted-foreground">{p.stockSku} · OEM {p.draft.partNumber || "—"}</small>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {p.operationalStatus}
                  <br />
                  {usd(p.draft.price)} · Qty {p.quantity}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={Search} title="Search real inventory to add a part." />
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">3. Manual Item</h3>
        <p className="mb-3 text-xs text-muted-foreground">For an item without a Parts Inventory record</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-1">
            <Label>Description</Label>
            <Input value={manualItem.description} onChange={(e) => setManualItem((v) => ({ ...v, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={manualItem.quantity} onChange={(e) => setManualItem((v) => ({ ...v, quantity: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit price ($)</Label>
            <Input type="number" min={0} step="0.01" value={manualItem.price} onChange={(e) => setManualItem((v) => ({ ...v, price: e.target.value }))} />
          </div>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={addManualItem}>
          Add Manual Item
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Manual items appear on the sale and invoice. No inventory quantity or SKU is changed.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">4. Draft Quote</h3>
        <p className="mb-3 text-xs text-muted-foreground">No inventory changes until a manager finalizes a sale</p>
        <div className="space-y-1.5">
          {cart.map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-md border border-border px-2.5 py-2">
              <span>
                <b className="block text-sm">{p.stockSku}</b>
                <small className="text-xs text-muted-foreground">{p.description}</small>
              </span>
              <Input
                aria-label="Quantity"
                type="number"
                min={1}
                max={p.manual ? undefined : p.availableQuantity}
                value={p.quantity}
                onChange={(e) => setCart((v) => v.map((x) => (x.id === p.id ? { ...x, quantity: Number(e.target.value) } : x)))}
                className="h-8 w-16"
              />
              <b className="text-sm">{usd(p.unitPrice * p.quantity)}</b>
              <button onClick={() => setCart((v) => v.filter((x) => x.id !== p.id))}>
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ))}
          {!cart.length && <p className="text-sm text-muted-foreground">No items added yet.</p>}
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <b>{usd(totals.subtotal)}</b>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax ({selectedCustomer?.taxStatus === "exempt" ? "Exempt" : "7.5%"})</span>
            <b>{usd(totals.tax)}</b>
          </div>
          <div className="flex justify-between border-t border-border pt-1 text-base">
            <strong>Total</strong>
            <b>{usd(totals.total)}</b>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={loading || !selectedCustomer || !cart.length} onClick={saveDraftQuote}>
            Save Draft Quote
          </Button>
          {manager && (
            <Button variant="outline" disabled={loading || !selectedCustomer || !cart.length} onClick={managerDirectSale}>
              Manager Direct Sale
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
