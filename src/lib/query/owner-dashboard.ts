"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ownerActivity,
  ownerEmployees,
  ownerPartsStatus,
  ownerSalesByDay,
  ownerSummary,
  ownerTodaySales,
  ownerTopSellingParts,
} from "@/lib/data/owner-dashboard";

/** Keys are per range (or per window, for the real-table reads below). Navigating back returns cached data
 * (staleTime), and nothing else in the cache is reset. */
export const ownerDashKeys = {
  summary: (from: string, to: string) => ["owner-dashboard", "summary", from, to] as const,
  employees: (from: string, to: string) => ["owner-dashboard", "employees", from, to] as const,
  activity: (from: string, to: string) => ["owner-dashboard", "activity", from, to] as const,
  partsStatus: () => ["owner-dashboard", "parts-status"] as const,
  todaySales: () => ["owner-dashboard", "today-sales"] as const,
  salesByDay: (days: number) => ["owner-dashboard", "sales-by-day", days] as const,
  topSellingParts: (days: number) => ["owner-dashboard", "top-selling-parts", days] as const,
};

export function useOwnerSummary(from: string, to: string) {
  return useQuery({ queryKey: ownerDashKeys.summary(from, to), queryFn: () => ownerSummary(from, to), enabled: !!from && !!to, staleTime: 60_000 });
}
export function useOwnerEmployees(from: string, to: string) {
  return useQuery({ queryKey: ownerDashKeys.employees(from, to), queryFn: () => ownerEmployees(from, to), enabled: !!from && !!to, staleTime: 60_000 });
}
export function useOwnerActivity(from: string, to: string, limit = 8) {
  return useQuery({ queryKey: ownerDashKeys.activity(from, to), queryFn: () => ownerActivity(from, to, limit), enabled: !!from && !!to, staleTime: 30_000 });
}
export function useOwnerPartsStatus() {
  return useQuery({ queryKey: ownerDashKeys.partsStatus(), queryFn: ownerPartsStatus, staleTime: 60_000 });
}
export function useOwnerTodaySales() {
  return useQuery({ queryKey: ownerDashKeys.todaySales(), queryFn: ownerTodaySales, staleTime: 60_000 });
}
export function useOwnerSalesByDay(days: number) {
  return useQuery({ queryKey: ownerDashKeys.salesByDay(days), queryFn: () => ownerSalesByDay(days), staleTime: 60_000 });
}
export function useOwnerTopSellingParts(days = 30, limit = 5) {
  return useQuery({ queryKey: ownerDashKeys.topSellingParts(days), queryFn: () => ownerTopSellingParts(days, limit), staleTime: 5 * 60_000 });
}
