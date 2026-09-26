"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const FALLBACK = ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "eu-west-1", "eu-central-1", "sa-east-1", "ap-southeast-1"];

/** Region options for per-resource region pickers (falls back to a static list when the API is unavailable). */
export function useRegionOptions(current: string) {
  const regions = useQuery({ queryKey: ["regions"], queryFn: api.regions, staleTime: 5 * 60_000 });
  const list = regions.data?.map((r) => ({ value: r.name, label: r.label && r.label !== r.name ? `${r.label} (${r.name})` : r.name })) ?? FALLBACK.map((r) => ({ value: r, label: r }));
  if (!list.some((r) => r.value === current)) list.unshift({ value: current, label: current });
  return list;
}
