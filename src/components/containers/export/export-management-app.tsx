"use client";

import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { useExportCounts, useExportList } from "@/lib/query/containers";
import { CONTAINER_STATUS_LABEL, type ExportBucket, type ExportContainerRow } from "@/lib/data/containers";
import { ExportContainerDetail } from "@/components/containers/export/export-container-detail";
import { NewContainerDialog } from "@/components/containers/export/new-container-dialog";
import { dateLabel } from "@/components/scrap/scrap-shared";

const TABS: { id: ExportBucket; label: string; count: (c: Record<string, number>) => number }[] = [
  { id: "all", label: "All", count: (c) => c.all ?? 0 },
  { id: "loading", label: "Loading / Open", count: (c) => c.loading ?? 0 },
  { id: "ready_for_invoice", label: "Ready for Invoice", count: (c) => c.ready_for_invoice ?? 0 },
  { id: "on_the_way", label: "On the Way", count: (c) => c.on_the_way ?? 0 },
  { id: "closed", label: "Closed", count: (c) => c.closed ?? 0 },
];

/** Export management: the same container rows the loader works on, with the confidential export view. */
export function ExportManagementApp() {
  const [bucket, setBucket] = useState<ExportBucket>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const counts = useExportCounts();
  const list = useExportList(bucket);
  const rows: ExportContainerRow[] = list.data?.pages.flatMap((p) => p.rows) ?? [];

  if (openId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
          <ArrowLeft className="size-4" /> Back to containers
        </Button>
        <ExportContainerDetail id={openId} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Container Export</h2>
          <p className="text-sm text-muted-foreground">Consignees, invoices, payments, shipping and close for loaded containers</p>
        </div>
        <Button className="h-9" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New Container
        </Button>
      </div>
      <NewContainerDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOpenId(id)} />

      {counts.isError && <p className="text-sm text-destructive">{counts.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setBucket(t.id)}
            className={`rounded-lg border px-3 py-2 text-left text-sm ${bucket === t.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
          >
            <span className="block text-lg font-semibold tabular-nums">{counts.data ? t.count(counts.data as unknown as Record<string, number>) : "—"}</span>
            <span className="block text-xs">{t.label}</span>
          </button>
        ))}
      </div>

      {list.isPending && <p className="text-sm text-muted-foreground">Loading containers…</p>}
      {list.isError && <p className="text-sm text-destructive">{list.error.message}</p>}
      {!list.isPending && rows.length === 0 && <EmptyState title="No containers in this view." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>LAL ref</TableHead>
                <TableHead>Container no.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Consignee</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.t_ref}</TableCell>
                  <TableCell>{r.container_number ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={r.status === "closed" ? "neutral" : r.status === "loading" ? "info" : "success"}>{CONTAINER_STATUS_LABEL[r.status].toUpperCase()}</StatusBadge>
                  </TableCell>
                  <TableCell>{r.consignee_company ?? "—"}</TableCell>
                  <TableCell>{r.invoice_number ?? (r.invoice_status ? r.invoice_status : "No invoice")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoice_total ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.balance ?? "—"}</TableCell>
                  <TableCell>{dateLabel(r.created_at.slice(0, 10))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.hasNextPage && (
        <Button variant="outline" className="w-full" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
