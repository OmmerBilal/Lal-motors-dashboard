"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleListRow } from "@/lib/data/vehicles";

/**
 * Bounded dispatch reads. Groups are summarised on the server; a group's vehicles load only when it is opened.
 * Each call is one page, so nothing loads the whole vehicle table to group it in the browser.
 */
export class DispatchReadError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.code = code;
  }
}

function fail(error: { message: string; code?: string } | null): never {
  throw new DispatchReadError(error?.message ?? "Request failed", error?.code);
}

export type DispatchFilters = { tab: string; search: string; auction: string | null };

export type PickupGroup = {
  name: string;
  address: string;
  vehicle_count: number;
  need_transport: number;
  ready_to_post: number;
  posted: number;
  assigned: number;
  in_transit: number;
  arrived: number;
  problem: number;
  overdue: number;
};

/** The group key the server uses: name and address together. The browser never builds its own key. */
export function groupKeyFor(g: Pick<PickupGroup, "name" | "address">) {
  return `${g.name}|${g.address}`;
}

export async function listPickupGroups(filters: DispatchFilters, after: string | null, limit = 50) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dispatch_pickup_groups", {
    p_tab: filters.tab,
    p_search: filters.search.trim() || null,
    p_auction: filters.auction,
    p_after: after,
    p_limit: limit,
  });
  if (error) fail(error);
  const page = data as { groups: PickupGroup[]; has_more: boolean; next_after: string | null };
  return { groups: page.groups, hasMore: page.has_more, nextAfter: page.next_after };
}

export async function listGroupVehicles(
  group: string,
  filters: DispatchFilters,
  cursor: { createdAt: string; id: string } | null,
  limit = 50,
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dispatch_group_vehicles", {
    p_group: group,
    p_tab: filters.tab,
    p_search: filters.search.trim() || null,
    p_auction: filters.auction,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) fail(error);
  const page = data as { rows: VehicleListRow[]; has_more: boolean };
  return { rows: page.rows, hasMore: page.has_more };
}

/** The receiving screen's inbound list: assigned or in transit, not yet received. Bounded to 200. */
export async function listInboundVehicles(): Promise<VehicleListRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("dispatch_inbound_vehicles", { p_limit: 200 });
  if (error) fail(error);
  return (data ?? []) as VehicleListRow[];
}
