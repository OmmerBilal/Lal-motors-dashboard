"use client";

import { useQuery } from "@tanstack/react-query";
import { ownerActivity, ownerEmployees, ownerSummary } from "@/lib/data/owner-dashboard";

/** Keys are per range. Navigating back returns cached data (staleTime), and nothing else in the cache is reset. */
export const ownerDashKeys = {
  summary: (from: string, to: string) => ["owner-dashboard", "summary", from, to] as const,
  employees: (from: string, to: string) => ["owner-dashboard", "employees", from, to] as const,
  activity: (from: string, to: string) => ["owner-dashboard", "activity", from, to] as const,
};

export function useOwnerSummary(from: string, to: string) {
  return useQuery({ queryKey: ownerDashKeys.summary(from, to), queryFn: () => ownerSummary(from, to), enabled: !!from && !!to, staleTime: 60_000 });
}
export function useOwnerEmployees(from: string, to: string) {
  return useQuery({ queryKey: ownerDashKeys.employees(from, to), queryFn: () => ownerEmployees(from, to), enabled: !!from && !!to, staleTime: 60_000 });
}
export function useOwnerActivity(from: string, to: string) {
  return useQuery({ queryKey: ownerDashKeys.activity(from, to), queryFn: () => ownerActivity(from, to, 8), enabled: !!from && !!to, staleTime: 30_000 });
}
