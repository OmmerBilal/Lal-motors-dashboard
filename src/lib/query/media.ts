"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** Saved original photos for one owner, from the server. Keys are scoped by owner and role prefix. */
export type OwnerPhoto = { id: string; role: string | null; mime_type: string; width: number | null; height: number | null; created_at: string };

export function useOwnerPhotos(ownerType: string, ownerId: string | null | undefined, rolePrefix: string) {
  return useQuery({
    queryKey: ["media", "owner", ownerType, ownerId ?? "", rolePrefix],
    enabled: !!ownerId,
    queryFn: async (): Promise<OwnerPhoto[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("media_list_for_owner", {
        p_owner_type: ownerType,
        p_owner_id: ownerId,
        p_role_prefix: rolePrefix,
        p_limit: 100,
      });
      if (error) throw new Error("Saved photos could not be loaded.");
      return (data ?? []) as OwnerPhoto[];
    },
  });
}
