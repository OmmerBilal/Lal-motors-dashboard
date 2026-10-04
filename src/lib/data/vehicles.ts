"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side vehicle service. Every call goes through a database RPC or read-model function
 * using the signed-in session, so the database decides authorization, never this file.
 */

export type VehicleStage = "waiting" | "transit" | "available" | "overdue" | "closed";

export type VehicleListRow = {
  id: string;
  vin: string | null;
  lot_number: string | null;
  stock_number: string | null;
  auction_source: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  status: string;
  transport_status: string;
  purchase_date: string;
  purchase_price: string;
  total_landed_cost: string;
  pickup_location_name: string;
  closed_reason: string | null;
  carrier_id: string | null;
  carrier_company: string | null;
  receiving_status: string;
  thumbnail_path: string | null;
  thumbnail_bucket: string | null;
  stage: VehicleStage;
  created_at: string;
};

export type VehicleListFilters = {
  stage: VehicleStage | null;
  auctionSource: string | null;
  carrierId: string | null;
  search: string;
  limit?: number;
};

export type VehicleListCursor = { createdAt: string; id: string } | null;

export type VehicleKpis = {
  total: number;
  waiting: number;
  transit: number;
  available: number;
  overdue: number;
  closed: number;
};

export type VehicleFilterOptions = {
  auction_sources: string[];
  carriers: { id: string; company: string }[];
};

export class VehicleServiceError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

function fail(error: { message: string; code?: string } | null): never {
  throw new VehicleServiceError(error?.message ?? "Request failed", error?.code);
}

export async function listVehicles(filters: VehicleListFilters, cursor: VehicleListCursor) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_vehicles", {
    p_stage: filters.stage,
    p_auction_source: filters.auctionSource,
    p_search: filters.search.trim() || null,
    p_limit: filters.limit ?? 25,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_carrier_id: filters.carrierId,
  });
  if (error) fail(error);
  const rows = (data ?? []) as (VehicleListRow & { has_more: boolean })[];
  const hasMore = rows.length > 0 && rows[0].has_more;
  return { rows: rows.map(({ has_more: _unused, ...row }) => row as VehicleListRow), hasMore };
}

export async function getVehicleKpis(): Promise<VehicleKpis> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_stage_counts");
  if (error) fail(error);
  const row = (data as Record<string, number | string>[])[0];
  return {
    total: Number(row.total),
    waiting: Number(row.waiting),
    transit: Number(row.transit),
    available: Number(row.available),
    overdue: Number(row.overdue),
    closed: Number(row.closed),
  };
}

export async function getVehicleFilterOptions(): Promise<VehicleFilterOptions> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("vehicle_filter_options");
  if (error) fail(error);
  return data as VehicleFilterOptions;
}

export async function closeVehicle(input: { vehicleId: string; reason: string; note: string }) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("close_vehicle", {
    p_vehicle_id: input.vehicleId,
    p_reason: input.reason,
    p_note: input.note,
  });
  if (error) fail(error);
  return data as { vehicle_id: string; status: string; closed_reason: string; idempotent_replay: boolean };
}
