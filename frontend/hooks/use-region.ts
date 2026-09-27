"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { usePreferences } from "@/stores/preferences";
import { useHydrated } from "./use-hydrated";

/** Used until the API answers (and during server rendering). */
const FALLBACK_REGION = "us-east-1";

export function useRegions() {
  return useQuery({ queryKey: queryKeys.regions, queryFn: api.regions, staleTime: 5 * 60_000 });
}

/**
 * Currently selected AWS region: the region the user picked (top bar or Settings), otherwise the
 * default region configured on the server (AWS_REGION), otherwise us-east-1.
 */
export function useRegion(): string {
  const hydrated = useHydrated();
  // The choice lives in localStorage, so it is only read after hydration to avoid a mismatch.
  const chosen = usePreferences((s) => s.region);
  const { data: regions } = useRegions();
  return (hydrated ? chosen : null) ?? regions?.find((r) => r.default)?.name ?? FALLBACK_REGION;
}
