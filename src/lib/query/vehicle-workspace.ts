"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addVehicleNote,
  applyVehicleMerge,
  createIntakeBatch,
  decideCompletion,
  editVehicleFields,
  getVehicleRecord,
  listPendingBatches,
  listPendingCompletions,
  listRecentVehicleEvents,
  listVehicleEvents,
} from "@/lib/data/vehicle-workspace";
import { listVehicles } from "@/lib/data/vehicles";
import { vehicleKeys } from "@/lib/query/vehicles";

/** Workspace keys sit under the vehicles root, so one targeted invalidation reaches every vehicle view. */
export const workspaceKeys = {
  record: (id: string) => [...vehicleKeys.all, "record", id] as const,
  events: (id: string) => [...vehicleKeys.all, "events", id] as const,
  activity: (actorName: string | undefined) => [...vehicleKeys.all, "activity", actorName ?? "all"] as const,
  completions: () => [...vehicleKeys.all, "completions"] as const,
};

export function useVehicleRecord(vehicleId: string | null) {
  return useQuery({
    queryKey: workspaceKeys.record(vehicleId ?? ""),
    queryFn: () => getVehicleRecord(vehicleId as string),
    enabled: Boolean(vehicleId),
  });
}

export function useVehicleEvents(vehicleId: string | null) {
  return useQuery({
    queryKey: workspaceKeys.events(vehicleId ?? ""),
    queryFn: () => listVehicleEvents(vehicleId as string),
    enabled: Boolean(vehicleId),
  });
}

/** Activity feed, keyset-paged by created_at. Page N+1 uses the last row of page N as the cursor. */
export function useRecentVehicleEvents(options: { actions?: string[]; actorName?: string } = {}) {
  const { actions, actorName } = options;
  return useInfiniteQuery({
    queryKey: [...workspaceKeys.activity(actorName), actions?.join(",") ?? "all"] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listRecentVehicleEvents({ before: pageParam, limit: 50, actions, actorName }),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].created_at : undefined),
  });
}

export function usePendingBatches() {
  return useQuery({ queryKey: [...vehicleKeys.all, "batches", "review"] as const, queryFn: listPendingBatches });
}

/** Server search for an existing vehicle by VIN, lot or stock (the database matches, not the browser). */
export function useVehicleLookup(search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: [...vehicleKeys.all, "lookup", term] as const,
    queryFn: async () => {
      const { rows } = await listVehicles({ stage: null, auctionSource: null, carrierId: null, search: term, limit: 5 }, null);
      return rows;
    },
    enabled: term.length >= 3,
  });
}

export function usePendingCompletions() {
  return useQuery({ queryKey: workspaceKeys.completions(), queryFn: listPendingCompletions });
}

export function useEditVehicle(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: Record<string, string>) => editVehicleFields(vehicleId, fields),
    onSuccess: (record) => {
      queryClient.setQueryData(workspaceKeys.record(vehicleId), (old: unknown) =>
        old ? { ...(old as object), record } : old,
      );
      queryClient.invalidateQueries({ queryKey: workspaceKeys.events(vehicleId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(undefined) });
    },
  });
}

export function useAddVehicleNote(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: "NOTE" | "ISSUE_FLAGGED"; note: string }) => addVehicleNote({ vehicleId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.events(vehicleId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(undefined) });
    },
  });
}

export function useCreateIntakeBatch() {
  return useMutation({ mutationFn: createIntakeBatch });
}

export function useDecideCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: decideCompletion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.completions() });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.kpis() });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(undefined) });
    },
  });
}

export function useApplyVehicleMerge(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { expectedUpdatedAt: string; changes: Record<string, string> }) =>
      applyVehicleMerge({ vehicleId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.record(vehicleId) });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.events(vehicleId) });
      queryClient.invalidateQueries({ queryKey: vehicleKeys.lists() });
    },
  });
}
