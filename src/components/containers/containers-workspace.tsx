"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Boxes, Camera, FileText, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import type { User } from "@/lib/types";
import { mockUsers } from "@/lib/mock/users";
import { containerFieldOrder, containerStatusOptions, emptyContainer, type ContainerJob } from "@/lib/mock/containers";
import { ContainersDataProvider, useContainersData } from "@/components/containers/containers-data-context";
import { ExportInvoicePanel } from "@/components/containers/export-invoice-panel";

function WorkspaceBody({ user, previewMode = false }: { user: User; previewMode?: boolean }) {
  const manager = user.role !== "employee";
  const { jobs, createJob, updateJob, addFile, addEvent } = useContainersData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newJob, setNewJob] = useState(false);
  const [form, setForm] = useState<typeof emptyContainer>(emptyContainer);
  const [note, setNote] = useState("");

  const selected = selectedId ? jobs.find((j) => j.id === selectedId) : null;
  const employees = mockUsers.filter((u) => u.role === "employee");

  function open(job: ContainerJob) {
    setNewJob(false);
    setSelectedId(job.id);
    setForm({
      containerNumber: job.containerNumber,
      truckingCompany: job.truckingCompany,
      destinationCountry: job.destinationCountry,
      destinationPort: job.destinationPort,
      consignee: job.consignee,
      loadingDate: job.loadingDate,
      totalCost: job.totalCost,
      depositPaid: job.depositPaid,
      finalPayment: job.finalPayment,
      status: job.status,
      assignedEmployeeId: job.assignedEmployeeId,
    });
  }

  function startNew() {
    setNewJob(true);
    setSelectedId(null);
    setForm(emptyContainer);
  }

  function saveJob() {
    if (newJob) {
      const id = createJob(form);
      toast.success("Container created");
      setNewJob(false);
      const created = { ...form, id, files: [], events: [] };
      open(created);
    } else if (selected) {
      updateJob(selected.id, form);
      toast.success("Container updated");
    }
  }

  function upload(kind: "loading_photo" | "loading_list" | "document", file?: File) {
    if (!file || !selected) return;
    addFile(selected.id, kind, file.name, file.type.startsWith("image/"));
    toast.success("Evidence saved");
  }

  function saveActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !note.trim()) return;
    addEvent(selected.id, user.name, "NOTE", note.trim());
    setNote("");
  }

  const balance = Math.max(0, Number(form.totalCost || 0) - Number(form.depositPaid || 0) - Number(form.finalPayment || 0));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Containers & Export Invoices</h2>
          <p className="text-sm text-muted-foreground">
            {manager ? "Manage container loading and export invoices." : previewMode ? "Test loading jobs and photos with Owner attribution." : "Your assigned loading jobs and photos."}
          </p>
        </div>
        {manager && (
          <Button onClick={startNew}>
            <Plus /> Create Container
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3">
            <h3 className="text-sm font-semibold">{manager ? "Container Jobs" : previewMode ? "Containers to test" : "Assigned Containers"}</h3>
          </div>
          {jobs.length ? (
            <div className="divide-y divide-border">
              {jobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => open(j)}
                  className={`block w-full px-3 py-2.5 text-left hover:bg-accent/30 ${selectedId === j.id ? "bg-accent/40" : ""}`}
                >
                  <b className="block text-sm">{j.containerNumber}</b>
                  <small className="text-xs text-muted-foreground">
                    {j.status} · {j.destinationPort || j.destinationCountry || "Destination pending"}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No container jobs assigned.</p>
          )}
        </div>

        <div className="space-y-4">
          {!newJob && !selected && (
            <div className="rounded-lg border border-border bg-card p-6">
              <EmptyState icon={Boxes} title="Select a container job to begin." />
            </div>
          )}

          {(newJob || selected) && (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold">{newJob ? "New Container" : `Container ${selected?.containerNumber}`}</h3>
                {manager ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {containerFieldOrder.map(([key, label]) => (
                      <div key={key} className="space-y-1.5">
                        <Label>{label}</Label>
                        <Input
                          disabled={!newJob && key === "containerNumber"}
                          type={key === "loadingDate" ? "date" : key.toLowerCase().includes("cost") || key.toLowerCase().includes("paid") || key === "finalPayment" ? "number" : "text"}
                          value={form[key] ?? ""}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v ?? "Planned" })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {containerStatusOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Assigned employee</Label>
                      <Select value={form.assignedEmployeeId || ""} onValueChange={(v) => setForm({ ...form, assignedEmployeeId: v || null })}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name} ({e.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Assigned to you · {selected?.status} · {selected?.loadingDate || "Date pending"}
                  </p>
                )}
                {manager && (
                  <>
                    <p className="mt-3 text-sm font-medium">Balance: {balance.toLocaleString("en-US", { style: "currency", currency: "USD" })}</p>
                    <Button className="mt-2" onClick={saveJob}>
                      {newJob ? "Create job" : "Save container"}
                    </Button>
                  </>
                )}
              </div>

              {selected && (
                <>
                  <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">Loading activity & evidence</h3>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                        <Camera className="size-4" /> Take / add loading photo
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { upload("loading_photo", e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {manager && (
                        <>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
                            <Upload className="size-4" /> Upload loading list
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => { upload("loading_list", e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-primary">
                            <FileText className="size-4" /> Add document
                            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { upload("document", e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                        </>
                      )}
                    </div>
                    {selected.files.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {selected.files.map((f) => (
                          <div key={f.id} className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-center">
                            <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-muted-foreground">
                              {f.isImage ? <Camera className="size-5" /> : <FileText className="size-5" />}
                            </div>
                            <small className="w-full truncate text-[11px] text-muted-foreground">{f.kind.replace("_", " ")}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    {user.role === "employee" && (
                      <form onSubmit={saveActivity} className="mt-3 flex gap-2">
                        <Input placeholder="Loading activity note" value={note} onChange={(e) => setNote(e.target.value)} />
                        <Button type="submit" disabled={!note.trim()}>
                          Save activity
                        </Button>
                      </form>
                    )}
                    {selected.events.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium">Loading history ({selected.events.length})</summary>
                        <div className="mt-2 space-y-1">
                          {selected.events.map((e) => (
                            <p key={e.id} className="text-xs text-muted-foreground">
                              {new Date(e.createdAt).toLocaleString()} · {e.userName} · {e.action}: {e.note}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>

                  {manager && <ExportInvoicePanel job={selected} />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContainersWorkspace({ user, previewMode = false }: { user: User; previewMode?: boolean }) {
  return (
    <ContainersDataProvider>
      <WorkspaceBody user={user} previewMode={previewMode} />
    </ContainersDataProvider>
  );
}
