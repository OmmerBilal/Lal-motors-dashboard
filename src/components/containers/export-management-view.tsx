"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Anchor, Boxes, Camera, CheckCircle2, FileText, Package, Plus, Search, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useContainersData } from "@/components/containers/containers-data-context";
import { InvoicePanel } from "@/components/containers/invoice-panel";
import { containerStatusLabels, emptyConsignee, type ContainerStatus, type ContainerJob } from "@/lib/mock/containers";
import type { User } from "@/lib/types";

const statusColors: Record<ContainerStatus, string> = {
  loading: "#2563eb",
  ready_for_invoice: "#d97706",
  on_the_way: "#16a34a",
  closed: "#64748b",
};

const statusIcons: Record<ContainerStatus, typeof Boxes> = {
  loading: Boxes,
  ready_for_invoice: FileText,
  on_the_way: Ship,
  closed: CheckCircle2,
};

function statusTone(status: ContainerStatus) {
  if (status === "loading") return "warning" as const;
  if (status === "ready_for_invoice") return "info" as const;
  if (status === "on_the_way") return "success" as const;
  return "neutral" as const;
}

const PAGE_SIZE = 10;

export function ExportManagementView({ user }: { user: User }) {
  const { jobs, consignees, getConsignee, createJob, updateJobMeta, addConsignee, markOnTheWay, closeContainer, reopenContainer, getInvoiceForContainer, getPaymentsForInvoice } =
    useContainersData();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContainerStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(jobs[0]?.id ?? null);
  const [detailTab, setDetailTab] = useState<"photos" | "list" | "documents" | "activity">("photos");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ containerNumber: "", truckingCompany: "", destinationCountry: "", destinationPort: "", consigneeId: null as string | null });
  const [createError, setCreateError] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ destinationCountry: "", destinationPort: "", truckingCompany: "", consigneeId: null as string | null, notes: "" });

  const [consigneeDialogOpen, setConsigneeDialogOpen] = useState(false);
  const [consigneeForm, setConsigneeForm] = useState(emptyConsignee);

  const [onWayOpen, setOnWayOpen] = useState(false);
  const [onWayForm, setOnWayForm] = useState({ shipDate: "", eta: "", note: "" });

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeOverride, setCloseOverride] = useState("");
  const [closeError, setCloseError] = useState("");

  const counts = useMemo(() => {
    const c: Record<ContainerStatus, number> = { loading: 0, ready_for_invoice: 0, on_the_way: 0, closed: 0 };
    jobs.forEach((j) => (c[j.status] += 1));
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    let list = jobs;
    if (statusFilter !== "all") list = list.filter((j) => j.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((j) => {
        const consignee = getConsignee(j.consigneeId);
        return (
          j.tRef.toLowerCase().includes(q) ||
          j.containerNumber.toLowerCase().includes(q) ||
          j.destinationPort.toLowerCase().includes(q) ||
          (consignee?.company || "").toLowerCase().includes(q) ||
          (getInvoiceForContainer(j.id)?.invoiceNumber || "").toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [jobs, statusFilter, search, getConsignee, getInvoiceForContainer]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const selected = selectedId ? jobs.find((j) => j.id === selectedId) : undefined;
  const selectedConsignee = selected ? getConsignee(selected.consigneeId) : undefined;

  function select(id: string) {
    setSelectedId(id);
    setDetailTab("photos");
  }

  function openCreate() {
    setCreateForm({ containerNumber: "", truckingCompany: "", destinationCountry: "", destinationPort: "", consigneeId: null });
    setCreateError("");
    setCreateOpen(true);
  }

  function submitCreate() {
    const res = createJob(createForm);
    if (res.error) {
      setCreateError(res.error);
      return;
    }
    toast.success("Container created");
    setCreateOpen(false);
    select(res.id);
  }

  function openEdit(job: ContainerJob) {
    setEditForm({ destinationCountry: job.destinationCountry, destinationPort: job.destinationPort, truckingCompany: job.truckingCompany, consigneeId: job.consigneeId, notes: job.notes });
    setEditOpen(true);
  }

  function submitEdit() {
    if (!selected) return;
    updateJobMeta(selected.id, editForm, user.name);
    toast.success("Container updated");
    setEditOpen(false);
  }

  function submitConsignee() {
    const id = addConsignee(consigneeForm);
    setConsigneeForm(emptyConsignee);
    setConsigneeDialogOpen(false);
    setEditForm((f) => ({ ...f, consigneeId: id }));
    toast.success("Consignee added");
  }

  function submitOnWay() {
    if (!selected) return;
    markOnTheWay(selected.id, onWayForm, user.name);
    toast.success("Marked On the Way");
    setOnWayOpen(false);
  }

  function submitClose() {
    if (!selected) return;
    const res = closeContainer(selected.id, user.name, closeOverride || undefined);
    if (!res.ok) {
      setCloseError(res.reason || "Cannot close container");
      return;
    }
    toast.success(`Container ${selected.tRef} closed`);
    setCloseOpen(false);
    setCloseOverride("");
    setCloseError("");
  }

  const invoice = selected ? getInvoiceForContainer(selected.id) : undefined;
  const invoicePayments = invoice ? getPaymentsForInvoice(invoice.id) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Container Export Management</h2>
          <p className="mt-1 text-sm text-muted-foreground">Track, manage, and export containers worldwide.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" /> New Container
        </Button>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by container number, consignee, destination, or invoice…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["loading", "ready_for_invoice", "on_the_way", "closed"] as ContainerStatus[]).map((s) => {
          const Icon = statusIcons[s];
          const color = statusColors[s];
          return (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className="flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/30"
              style={{ backgroundColor: statusFilter === s ? `${color}22` : `${color}14` }}
            >
              <span className="flex size-9 items-center justify-center rounded-md" style={{ backgroundColor: `${color}26`, color }}>
                <Icon className="size-5" />
              </span>
              <span className="text-2xl leading-none font-semibold tabular-nums">{counts[s]}</span>
              <span className="text-sm font-semibold">{containerStatusLabels[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} onClick={() => { setStatusFilter("all"); setPage(1); }}>
          All Containers ({jobs.length})
        </Button>
        {(["loading", "ready_for_invoice", "on_the_way", "closed"] as ContainerStatus[]).map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => { setStatusFilter(s); setPage(1); }}>
            {containerStatusLabels[s]} ({counts[s]})
          </Button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Container No.</th>
                  <th className="px-3 py-2 font-medium">Consignee</th>
                  <th className="px-3 py-2 font-medium">Destination</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Ship Date</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((j) => (
                  <tr key={j.id} className={`cursor-pointer border-b border-border last:border-0 hover:bg-accent/30 ${selectedId === j.id ? "bg-accent/40" : ""}`} onClick={() => select(j.id)}>
                    <td className="px-3 py-2 font-semibold text-primary">{j.tRef}</td>
                    <td className="px-3 py-2">{j.containerNumber || "—"}</td>
                    <td className="px-3 py-2 truncate">{getConsignee(j.consigneeId)?.company || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{j.destinationPort || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={statusTone(j.status)}>{containerStatusLabels[j.status]}</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{j.shipDate ? new Date(j.shipDate).toLocaleDateString() : "—"}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); select(j.id); }}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
                {!paged.length && (
                  <tr>
                    <td colSpan={7} className="p-6">
                      <EmptyState icon={Boxes} title="No containers match" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span>
                Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>
                  Prev
                </Button>
                <Button size="sm" variant="outline" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {!selected ? (
            <div className="rounded-lg border border-border bg-card p-6">
              <EmptyState icon={Boxes} title="Select a container" />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold">Container {selected.tRef}</h3>
                  <div className="flex gap-2">
                    <StatusBadge tone={statusTone(selected.status)}>{containerStatusLabels[selected.status]}</StatusBadge>
                    <Button size="sm" variant="outline" onClick={() => openEdit(selected)}>
                      Edit
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">Container No.</span>
                  <span className="text-right font-medium">{selected.containerNumber || "Not confirmed"}</span>
                  <span className="text-muted-foreground">Consignee</span>
                  <span className="text-right font-medium">{selectedConsignee?.company || "Not assigned"}</span>
                  <span className="text-muted-foreground">Destination</span>
                  <span className="text-right font-medium">{selected.destinationPort || "—"}</span>
                  <span className="text-muted-foreground">Started</span>
                  <span className="text-right font-medium">{selected.startedAt ? new Date(selected.startedAt).toLocaleDateString() : "—"}</span>
                  <span className="text-muted-foreground">Est. Ship Date</span>
                  <span className="text-right font-medium">{selected.shipDate ? new Date(selected.shipDate).toLocaleDateString() : "—"}</span>
                  <span className="text-muted-foreground">Created By</span>
                  <span className="text-right font-medium">{selected.createdByName}</span>
                  <span className="text-muted-foreground">Last Update</span>
                  <span className="text-right font-medium">{new Date(selected.lastUpdateAt).toLocaleString()}</span>
                </div>
                {selected.notes && (
                  <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                    <b className="mb-0.5 block">Notes</b>
                    {selected.notes}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex gap-1 rounded-md bg-muted p-1 text-xs font-medium">
                  {(["photos", "list", "documents", "activity"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setDetailTab(t)}
                      className={`flex-1 rounded px-2 py-1.5 capitalize transition-colors ${detailTab === t ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"}`}
                    >
                      {t === "photos"
                        ? `Photos (${selected.files.filter((f) => f.kind !== "document").length})`
                        : t === "list"
                          ? `Loading List (${selected.loadingListDraft.length})`
                          : t === "documents"
                            ? `Documents (${selected.files.filter((f) => f.kind === "document").length})`
                            : `Activity (${selected.events.length})`}
                    </button>
                  ))}
                </div>

                {detailTab === "photos" && (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {selected.files
                      .filter((f) => f.kind !== "document")
                      .map((f) => (
                        <div key={f.id} className="space-y-1 rounded-md border border-border p-1.5 text-center">
                          <div className="flex aspect-square items-center justify-center rounded bg-muted text-muted-foreground">
                            <Camera className="size-5" />
                          </div>
                          <p className="truncate text-[10px] text-muted-foreground">{f.caption}</p>
                        </div>
                      ))}
                    {!selected.files.length && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No photos yet.</p>}
                  </div>
                )}

                {detailTab === "list" && (
                  <div className="mt-3 space-y-1.5 text-sm">
                    {selected.loadingListDraft.length ? (
                      selected.loadingListDraft.map((line) => (
                        <div key={line.id} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-xs">
                          <span className="truncate">{line.description}</span>
                          <span className="shrink-0 text-muted-foreground">×{line.quantity}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">No loading-list transcription yet. Create an invoice to draft one from evidence.</p>
                    )}
                  </div>
                )}

                {detailTab === "documents" && (
                  <div className="mt-3 space-y-1.5">
                    {selected.files.filter((f) => f.kind === "document").length ? (
                      selected.files
                        .filter((f) => f.kind === "document")
                        .map((f) => (
                          <div key={f.id} className="flex items-center gap-2 rounded border border-border px-2.5 py-1.5 text-xs">
                            <FileText className="size-3.5 text-muted-foreground" /> {f.caption}
                          </div>
                        ))
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">No documents uploaded.</p>
                    )}
                  </div>
                )}

                {detailTab === "activity" && (
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {[...selected.events].reverse().map((e) => (
                      <div key={e.id} className="text-xs">
                        <span className="font-medium">{e.action.replaceAll("_", " ")}</span> · {e.note}
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(e.createdAt).toLocaleString()} · {e.userName}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <InvoicePanel job={selected} user={user} />

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" disabled>
                    <Camera className="size-4" /> Add Photo
                  </Button>
                  <Button variant="outline" size="sm" disabled>
                    <Package className="size-4" /> Update Loading List
                  </Button>
                  <Button
                    size="sm"
                    disabled={selected.status !== "ready_for_invoice"}
                    onClick={() => {
                      setOnWayForm({ shipDate: "", eta: "", note: "" });
                      setOnWayOpen(true);
                    }}
                  >
                    <Anchor className="size-4" /> On the Way
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selected.status === "closed"}
                    onClick={() => {
                      setCloseOverride("");
                      setCloseError("");
                      setCloseOpen(true);
                    }}
                  >
                    <CheckCircle2 className="size-4" /> Close Container
                  </Button>
                </div>
                {selected.status === "closed" && (
                  <Button variant="ghost" size="sm" className="mt-2 w-full text-muted-foreground" onClick={() => reopenContainer(selected.id, user.name, "Reopened for correction")}>
                    Reopen container
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Container */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Container</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Official container number (optional)</Label>
              <Input value={createForm.containerNumber} onChange={(e) => setCreateForm({ ...createForm, containerNumber: e.target.value })} placeholder="e.g. MSCU9934210" />
            </div>
            <div className="space-y-1.5">
              <Label>Trucking / logistics company</Label>
              <Input value={createForm.truckingCompany} onChange={(e) => setCreateForm({ ...createForm, truckingCompany: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Destination country</Label>
                <Input value={createForm.destinationCountry} onChange={(e) => setCreateForm({ ...createForm, destinationCountry: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Destination port / city</Label>
                <Input value={createForm.destinationPort} onChange={(e) => setCreateForm({ ...createForm, destinationPort: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Consignee</Label>
              <Select value={createForm.consigneeId || ""} onValueChange={(v) => setCreateForm({ ...createForm, consigneeId: v || null })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Assign later">
                    {(value: string | null) => consignees.find((c) => c.id === value)?.company || "Assign later"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {consignees.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError && <p className="text-sm font-medium text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate}>A T-reference is assigned automatically</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Container */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit container {selected?.tRef}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Destination country</Label>
                <Input value={editForm.destinationCountry} onChange={(e) => setEditForm({ ...editForm, destinationCountry: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Destination port / city</Label>
                <Input value={editForm.destinationPort} onChange={(e) => setEditForm({ ...editForm, destinationPort: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Trucking / logistics company</Label>
              <Input value={editForm.truckingCompany} onChange={(e) => setEditForm({ ...editForm, truckingCompany: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Consignee</Label>
              <div className="flex gap-2">
                <Select value={editForm.consigneeId || ""} onValueChange={(v) => setEditForm({ ...editForm, consigneeId: v || null })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unassigned">
                      {(value: string | null) => consignees.find((c) => c.id === value)?.company || "Unassigned"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {consignees.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => setConsigneeDialogOpen(true)}>
                  + New
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Operational notes</Label>
              <Textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Consignee */}
      <Dialog open={consigneeDialogOpen} onOpenChange={setConsigneeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New consignee</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(emptyConsignee) as (keyof typeof emptyConsignee)[]).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label className="capitalize">{k.replace(/([A-Z])/g, " $1")}</Label>
                <Input value={consigneeForm[k]} onChange={(e) => setConsigneeForm({ ...consigneeForm, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsigneeDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!consigneeForm.company.trim()} onClick={submitConsignee}>
              Save consignee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* On the Way */}
      <Dialog open={onWayOpen} onOpenChange={setOnWayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark {selected?.tRef} On the Way</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ship / departure date</Label>
                <Input type="date" value={onWayForm.shipDate} onChange={(e) => setOnWayForm({ ...onWayForm, shipDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>ETA</Label>
                <Input type="date" value={onWayForm.eta} onChange={(e) => setOnWayForm({ ...onWayForm, eta: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Shipping note (optional)</Label>
              <Textarea rows={2} value={onWayForm.note} onChange={(e) => setOnWayForm({ ...onWayForm, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOnWayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitOnWay}>Mark On the Way</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Container */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close container {selected?.tRef}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Container No.</span> <b>{selected.containerNumber}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Invoice #</span> <b>{invoice?.invoiceNumber || "—"}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Payments received</span> <b>{invoicePayments.length}</b>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Shipping status</span> <b>{containerStatusLabels[selected.status]}</b>
              </p>
              {closeError && (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <p>{closeError}</p>
                  <Input placeholder="Authorized override reason" value={closeOverride} onChange={(e) => setCloseOverride(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitClose}>{closeError ? "Close with override" : "Close container"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
