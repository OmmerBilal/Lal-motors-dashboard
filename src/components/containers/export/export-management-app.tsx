"use client";

import { useState } from "react";
import { ArrowLeft, Boxes, CheckCircle2, FileText, Plus, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/patterns/status-badge";
import { MetricCard } from "@/components/patterns/metric-card";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { useExportCounts, useExportList } from "@/lib/query/containers";
import { CONTAINER_STATUS_LABEL, CONTAINER_STATUS_TONE, type ExportBucket, type ExportContainerRow, type ExportCounts } from "@/lib/data/containers";
import { ExportContainerDetail } from "@/components/containers/export/export-container-detail";
import { NewContainerDialog } from "@/components/containers/export/new-container-dialog";
import { dateLabel } from "@/components/scrap/scrap-shared";
import type { StatusTone } from "@/components/patterns/status-badge";

const TABS: { id: ExportBucket; label: string; icon: LucideIcon; tone: StatusTone; count: (c: ExportCounts) => number }[] = [
  { id: "all", label: "All", icon: Boxes, tone: "neutral", count: (c) => c.all },
  { id: "loading", label: "Loading / Open", icon: Boxes, tone: CONTAINER_STATUS_TONE.loading, count: (c) => c.loading },
  { id: "ready_for_invoice", label: "Ready for Invoice", icon: FileText, tone: CONTAINER_STATUS_TONE.ready_for_invoice, count: (c) => c.ready_for_invoice },
  { id: "on_the_way", label: "On the Way", icon: Truck, tone: CONTAINER_STATUS_TONE.on_the_way, count: (c) => c.on_the_way },
  { id: "closed", label: "Closed", icon: CheckCircle2, tone: CONTAINER_STATUS_TONE.closed, count: (c) => c.closed },
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Containers"
        title="Container Export"
        description="Consignees, invoices, payments, shipping and close for loaded containers."
        actions={
          <Button size="lg" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> New Container
          </Button>
        }
      />
      <NewContainerDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOpenId(id)} />

      {counts.isError && <p className="text-sm text-destructive">{counts.error.message}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TABS.map((t) => (
          <MetricCard
            key={t.id}
            icon={t.icon}
            tone={t.tone}
            label={t.label}
            value={counts.data ? t.count(counts.data) : "—"}
            onClick={() => setBucket(t.id)}
            active={bucket === t.id}
          />
        ))}
      </div>

      {list.isPending && <p className="text-sm text-muted-foreground">Loading containers…</p>}
      {list.isError && <p className="text-sm text-destructive">{list.error.message}</p>}
      {!list.isPending && rows.length === 0 && (
        <EmptyState icon={Boxes} title="No containers in this view" description="Try a different filter, or create a new container." />
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>LAL Ref</TableHead>
                <TableHead>Container No.</TableHead>
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
                  <TableCell className="text-muted-foreground">{r.container_number ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge tone={CONTAINER_STATUS_TONE[r.status]}>{CONTAINER_STATUS_LABEL[r.status].toUpperCase()}</StatusBadge>
                  </TableCell>
                  <TableCell>{r.consignee_company ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {r.invoice_number ? (
                      <span className="font-medium">{r.invoice_number}</span>
                    ) : r.invoice_status ? (
                      <StatusBadge tone="neutral">{r.invoice_status.toUpperCase()}</StatusBadge>
                    ) : (
                      <span className="text-muted-foreground">No invoice</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.invoice_total ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.balance ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{dateLabel(r.created_at.slice(0, 10))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                      Open
                    </Button>
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
