"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/data/dismantling-v2";

/** Stable keys. Every mutation invalidates only the keys it changes, never the whole dismantling domain. */
export const dismantlingKeys = {
  admin: (tab: string, search: string) => ["dismantling-v2", "admin", tab, search] as const,
  adminAll: () => ["dismantling-v2", "admin"] as const,
  workload: () => ["dismantling-v2", "workload"] as const,
  record: (vehicleId: string) => ["dismantling-v2", "record", vehicleId] as const,
  mine: () => ["dismantling-v2", "mine"] as const,
  workspace: (assignmentId: string) => ["dismantling-v2", "workspace", assignmentId] as const,
};

export function useAdminVehicles(tab: api.DismantlingTab, search: string, page: number) {
  const pageSize = 50;
  return useQuery({
    queryKey: [...dismantlingKeys.admin(tab, search), page],
    queryFn: () => api.listDismantlingVehicles(tab, search, page * pageSize, pageSize),
    placeholderData: (prev) => prev,
  });
}

export function useWorkload() {
  return useQuery({ queryKey: dismantlingKeys.workload(), queryFn: api.getDismantlingWorkload, staleTime: 15_000 });
}

export function useVehicleRecord(vehicleId: string | null) {
  return useQuery({
    queryKey: dismantlingKeys.record(vehicleId ?? ""),
    queryFn: () => api.getDismantlingVehicleRecord(vehicleId as string),
    enabled: !!vehicleId,
  });
}

export function useMyAssignments() {
  return useQuery({ queryKey: dismantlingKeys.mine(), queryFn: api.listMyDismantlingAssignments });
}

export function useMyWorkspace(assignmentId: string | null) {
  return useQuery({
    queryKey: dismantlingKeys.workspace(assignmentId ?? ""),
    queryFn: () => api.getMyDismantlingWorkspace(assignmentId as string),
    enabled: !!assignmentId,
  });
}

/** Manager assignment changes refresh the admin lists, the workload and that vehicle's record. Nothing else. */
export function useAssignmentMutation() {
  const queryClient = useQueryClient();
  const refresh = (vehicleId?: string) => {
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.adminAll() });
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.workload() });
    if (vehicleId) queryClient.invalidateQueries({ queryKey: dismantlingKeys.record(vehicleId) });
  };
  return {
    markReady: useMutation({ mutationFn: (vehicleId: string) => api.markVehicleReady(vehicleId), onSuccess: (_d, id) => refresh(id) }),
    undoReady: useMutation({ mutationFn: ({ vehicleId, reason }: { vehicleId: string; reason: string }) => api.undoVehicleReady(vehicleId, reason), onSuccess: (_d, v) => refresh(v.vehicleId) }),
    assign: useMutation({ mutationFn: ({ vehicleId, employeeId }: { vehicleId: string; employeeId: string }) => api.assignDismantlingVehicle(vehicleId, employeeId), onSuccess: (_d, v) => refresh(v.vehicleId) }),
    reassign: useMutation({ mutationFn: ({ assignmentId, employeeId, reason }: { vehicleId: string; assignmentId: string; employeeId: string; reason: string }) => api.reassignDismantlingAssignment(assignmentId, employeeId, reason), onSuccess: (_d, v) => refresh(v.vehicleId) }),
    cancel: useMutation({ mutationFn: ({ assignmentId, reason }: { vehicleId: string; assignmentId: string; reason: string }) => api.cancelDismantlingAssignment(assignmentId, reason), onSuccess: (_d, v) => refresh(v.vehicleId) }),
  };
}

/** Employee work refreshes only that assignment's workspace and the employee's own list. */
export function useEmployeeMutations(assignmentId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.workspace(assignmentId) });
    queryClient.invalidateQueries({ queryKey: dismantlingKeys.mine() });
  };
  return {
    start: useMutation({ mutationFn: () => api.startDismantlingAssignment(assignmentId), onSuccess: refresh }),
    beginPart: useMutation({ mutationFn: ({ sessionId, name, details }: { sessionId: string; name: string; details: string }) => api.beginDismantledPart(sessionId, name, details), onSuccess: refresh }),
    updatePart: useMutation({ mutationFn: ({ partId, name, details }: { partId: string; name: string; details: string }) => api.updatePartCapture(partId, name, details), onSuccess: refresh }),
    savePart: useMutation({ mutationFn: (partId: string) => api.saveDismantledPart(partId), onSuccess: refresh }),
    abandonPart: useMutation({ mutationFn: (partId: string) => api.abandonDismantledPart(partId), onSuccess: refresh }),
    finish: useMutation({ mutationFn: (sessionId: string) => api.finishDismantlingSession(sessionId), onSuccess: refresh }),
    flagIssue: useMutation({ mutationFn: ({ sessionId, issue, note }: { sessionId: string; issue: string; note: string }) => api.flagDismantlingIssue(sessionId, issue, note), onSuccess: refresh }),
    refresh,
  };
}
