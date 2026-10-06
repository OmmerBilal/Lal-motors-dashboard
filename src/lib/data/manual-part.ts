"use client";

import { createClient } from "@/lib/supabase/client";

/** A real inventory part added by hand. No donor vehicle. The server checks the fields and the SKU, and writes history. */
export type ManualPartInput = {
  partName: string;
  quantity: number;
  price: number;
  category?: string;
  partNumber?: string;
  condition?: string;
  location?: string;
  notes?: string;
  stockSku?: string;
};

export async function createManualInventoryPart(input: ManualPartInput, clientRequestId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_manual_inventory_part", {
    p_fields: {
      part_name: input.partName,
      quantity: input.quantity,
      price: input.price,
      category: input.category ?? "",
      part_number: input.partNumber ?? "",
      condition: input.condition ?? "",
      location: input.location ?? "",
      part_notes: input.notes ?? "",
      stock_sku: input.stockSku ?? "",
    },
    p_client_request_id: clientRequestId,
  });
  if (error) {
    const err = new Error(error.message) as Error & { hint?: string | null };
    err.hint = (error as { hint?: string | null }).hint ?? null;
    throw err;
  }
  return data as { part_id: string; stock_sku: string | null; quantity: number; idempotent_replay: boolean };
}
