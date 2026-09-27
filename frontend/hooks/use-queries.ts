"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useRegion } from "./use-region";

/** Shared TanStack Query hooks for the read endpoints of the Go API (keys in lib/query-keys.ts). */
export { queryKeys } from "@/lib/query-keys";
export { useRegions } from "./use-region";

export function useServices() {
  return useQuery({ queryKey: queryKeys.services, queryFn: api.services, staleTime: 30_000 });
}

export function useService(id: string) {
  return useQuery({ queryKey: queryKeys.service(id), queryFn: () => api.service(id), staleTime: 15_000 });
}

export function useFlociStatus() {
  return useQuery({ queryKey: queryKeys.flociStatus, queryFn: api.flociStatus, refetchInterval: 10_000, retry: 0 });
}

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard, refetchInterval: 15_000 });
}

export function useResources(query: { region?: string; service?: string; q?: string; tag?: string; type?: string }) {
  return useQuery({ queryKey: queryKeys.resources(query), queryFn: () => api.resources(query) });
}

export function useServiceResources(service: string, options?: { enabled?: boolean }) {
  const region = useRegion();
  return useQuery({ queryKey: queryKeys.serviceResources(service, region), queryFn: () => api.serviceResources(service, region), enabled: options?.enabled });
}

export function useLogs(query: { service?: string; operation?: string; status?: string; source?: string; q?: string; limit?: number }, refetchInterval?: number | false) {
  return useQuery({ queryKey: queryKeys.logs(query), queryFn: () => api.logs(query), refetchInterval });
}

export function useLog(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.log(id ?? ""), queryFn: () => api.log(id as string), enabled: !!id });
}

export function useEvents(query: { service?: string; type?: string; q?: string; limit?: number }, refetchInterval?: number | false) {
  return useQuery({ queryKey: queryKeys.events(query), queryFn: () => api.events(query), refetchInterval });
}

export function useArchitecture() {
  const region = useRegion();
  return useQuery({ queryKey: queryKeys.architecture(region), queryFn: () => api.architecture(region) });
}
