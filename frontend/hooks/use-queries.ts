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

/** Target (Floci or AWS) and its health, polled every 10s. */
export function useTargetStatus() {
  return useQuery({ queryKey: queryKeys.target, queryFn: api.target, refetchInterval: 10_000, retry: 0 });
}

/**
 * What the console operates (Floci or the single AWS account of the Go API credentials),
 * from the same query as useTargetStatus.
 * `target` is undefined until the first answer; Floci-only UI (coverage, host hints) waits for it.
 */
export function useTarget() {
  const { data } = useTargetStatus();
  return {
    target: data?.target,
    isFloci: data?.target === "floci",
    isAws: data?.target === "aws",
    /** "Floci" or "AWS"; Floci (the Go API default) until the first answer. */
    name: data?.name ?? "Floci",
    accountId: data?.accountId ?? "",
  };
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
