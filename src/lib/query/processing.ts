"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveDismantledPart,
  editAndApprovePart,
  keepPartForReview,
  markPartDuplicate,
  rejectDismantledPart,
} from "@/lib/data/processing";
import { processingKeys } from "@/components/dismantling-processing/use-dismantling-data";

/**
 * Review decisions. Each one invalidates the processing namespace only (queue, completions,
 * activity, vehicles). Nothing outside Dismantling Processing is refreshed.
 */
function useDecision<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: processingKeys.all }),
  });
}

export const useApprovePart = () => useDecision((partId: string) => approveDismantledPart(partId));
export const useEditApprovePart = () =>
  useDecision((args: { partId: string; fields: Record<string, string | boolean> }) => editAndApprovePart(args.partId, args.fields));
export const useRejectPart = () => useDecision((args: { partId: string; reason: string }) => rejectDismantledPart(args.partId, args.reason));
export const useMarkDuplicate = () =>
  useDecision((args: { partId: string; duplicateOf: string }) => markPartDuplicate(args.partId, args.duplicateOf));
export const useKeepForReview = () => useDecision((partId: string) => keepPartForReview(partId));
