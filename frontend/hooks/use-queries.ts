"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRegion } from "./use-region";

/**
 * Shared TanStack Query hooks for the read endpoints of the Go API.
 * Query keys start with the prefixes invalidated by useAwsOperation
 * ("resources", "logs", "events", "dashboard", "architecture") so every mutation refreshes them.
 */
export const queryKeys = {
  services: ["services"] as const,
  service: (id: string) => ["services", id] as const,
  regions: ["regions"] as const,
  flociStatus: ["floci-status"] as const,
  dashboard: ["dashboard"] as const,
  resources: (query: Record<string, string | undefined>) => ["resources", "all", query] as const,
  serviceResources: (service: string, region: string) => ["resources", "service", service, region] as const,
  logs: (query: Record<string, string | number | undefined>) => ["logs", "list", query] as const,
  log: (id: string) => ["logs", "detail", id] as const,
  events: (query: Record<string, string | number | undefined>) => ["events", "list", query] as const,
  architecture: (region: string) => ["architecture", region] as const,
};

export function useServices() {
  return useQuery({ queryKey: queryKeys.services, queryFn: api.services, staleTime: 30_000 });
}

export function useService(id: string) {
  return useQuery({ queryKey: queryKeys.service(id), queryFn: () => api.service(id), staleTime: 15_000 });
}

export function useRegions() {
  return useQuery({ queryKey: queryKeys.regions, queryFn: api.regions, staleTime: 5 * 60_000 });
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

export function useServiceResources(service: string) {
  const region = useRegion();
  return useQuery({ queryKey: queryKeys.serviceResources(service, region), queryFn: () => api.serviceResources(service, region) });
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
