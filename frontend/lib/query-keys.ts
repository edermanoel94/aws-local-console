/**
 * TanStack Query keys for the read endpoints of the Go API.
 * Keys start with the prefixes invalidated by useAwsOperation
 * ("resources", "logs", "events", "dashboard", "architecture") so every mutation refreshes them.
 */
export const queryKeys = {
  services: ["services"] as const,
  service: (id: string) => ["services", id] as const,
  regions: ["regions"] as const,
  target: ["target"] as const,
  dashboard: ["dashboard"] as const,
  resources: (query: Record<string, string | undefined>) => ["resources", "all", query] as const,
  serviceResources: (service: string, region: string) => ["resources", "service", service, region] as const,
  logs: (query: Record<string, string | number | undefined>) => ["logs", "list", query] as const,
  log: (id: string) => ["logs", "detail", id] as const,
  events: (query: Record<string, string | number | undefined>) => ["events", "list", query] as const,
  architecture: (region: string) => ["architecture", region] as const,
};
