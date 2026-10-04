"use client";

import { createClient } from "@/lib/supabase/client";
import type { PartDraft, PartRecord, PartStage, PartStatus, TestStatus } from "@/lib/mock/parts";

/** Parts Inventory data layer. Every write goes through a database RPC; nothing here decides. */

export type PartListRow = {
  id: string;
  part_name: string;
  category: string;
  part_number: string;
  side_location: string;
  condition: string;
  fitment: string;
  fitment_status: string;
  title: string;
  description: string;
  keywords: string;
  status: string;
  stage: string | null;
  not_sellable_reason: string | null;
  operational_status: string;
  quantity: number;
  price: string;
  core_charge: string | null;
  has_core_charge: boolean;
  sale_channels: string[] | null;
  stock_sku: string | null;
  location: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
  test_status: string | null;
  test_notes: string;
  part_notes: string;
  source_vin: string | null;
  source_lot: string | null;
  vehicle_id: string | null;
  created_at: string;
  out_of_stock: boolean;
  thumbnail_path: string | null;
  thumbnail_bucket: string | null;
  has_more?: boolean;
};

export type PartDetailPayload = {
  part: Record<string, unknown>;
  donor_vehicle: { id: string; vin: string | null; lot_number: string | null; stock_number: string | null; label: string; auction_source: string } | null;
  session: { id: string; status: string; started_at: string; ended_at: string | null; employee_name: string } | null;
  photos: { media_id: string; role: string | null; created_at: string }[];
  history: {
    action_type: string;
    note: string;
    previous_status: string | null;
    new_status: string | null;
    previous_location: string | null;
    new_location: string | null;
    actor_name: string;
    actor_role: string;
    created_at: string;
  }[];
};

function fail(error: { message: string; hint?: string | null } | null): never {
  const e = new Error(error?.message ?? "Request failed") as Error & { hint?: string };
  e.hint = error?.hint ?? undefined;
  throw e;
}

/** Whole Parts Inventory, keyset-paged. Zero-quantity rows are included. */
export async function listAllParts(): Promise<PartListRow[]> {
  const supabase = createClient();
  const all: PartListRow[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await supabase.rpc("list_parts", {
      p_search: null,
      p_stage: null,
      p_status: null,
      p_operational: null,
      p_limit: 100,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
    });
    if (error) fail(error);
    const rows = (data ?? []) as PartListRow[];
    all.push(...rows);
    if (!rows.length || !rows[0].has_more) break;
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }
  return all;
}

export async function getPartDetail(partId: string): Promise<PartDetailPayload> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_part_detail", { p_part_id: partId });
  if (error) fail(error);
  return data as PartDetailPayload;
}

export function rowToPart(r: PartListRow): PartRecord {
  return {
    id: r.id,
    status: r.status as PartStatus,
    capturedByName: "",
    createdAt: r.created_at,
    photos: [],
    draft: {
      sourceVin: r.source_vin ?? "",
      sourceLot: r.source_lot ?? "",
      partName: r.part_name,
      category: r.category,
      partNumber: r.part_number,
      sideLocation: r.side_location,
      condition: r.condition,
      fitment: r.fitment,
      fitmentStatus: r.fitment_status,
      title: r.title,
      description: r.description,
      keywords: r.keywords,
      price: r.price,
      location: r.location,
    } as PartDraft,
    stockSku: r.stock_sku || null,
    operationalStatus: r.operational_status,
    quantity: r.quantity,
    zone: r.zone,
    rack: r.rack,
    shelf: r.shelf,
    bin: r.bin,
    history: [],
    logs: [],
    stage: (r.stage ?? "needs_processing") as PartStage,
    partCode: r.part_number || r.id.slice(0, 8).toUpperCase(),
    donor: null,
    partNotes: r.part_notes,
    testStatus: (r.test_status ?? undefined) as TestStatus | undefined,
    testNotes: r.test_notes,
    coreCharge: r.core_charge == null ? "" : String(r.core_charge),
    hasCoreCharge: r.has_core_charge,
    saleChannels: r.sale_channels ?? [],
    notSellable: r.not_sellable_reason ? { reason: r.not_sellable_reason, markedBy: "", markedAt: "" } : null,
  };
}

export async function updatePartFields(partId: string, fields: Record<string, string | boolean | string[]>, note?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_part_fields", { p_part_id: partId, p_fields: fields, p_note: note ?? null });
  if (error) fail(error);
  return data as { part_id: string; changed: string[] };
}

export async function setPartStage(partId: string, stage: string, note?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_part_stage", { p_part_id: partId, p_stage: stage, p_note: note ?? null });
  if (error) fail(error);
  return data as { part_id: string; stage: string };
}

export async function markPartNotSellable(partId: string, reason: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mark_part_not_sellable", { p_part_id: partId, p_reason: reason });
  if (error) fail(error);
  return data as { part_id: string; stage: string };
}

export async function reopenPartProcessing(partId: string, note: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("reopen_part_processing", { p_part_id: partId, p_note: note });
  if (error) fail(error);
  return data as { part_id: string; stage: string };
}

export async function setPartOperationalStatus(partId: string, status: string, note: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("set_part_operational_status", { p_part_id: partId, p_status: status, p_note: note });
  if (error) fail(error);
  return data as { part_id: string; operational_status: string };
}
