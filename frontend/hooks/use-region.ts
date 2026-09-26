import { usePreferences } from "@/stores/preferences";

/** Currently selected AWS region (top bar region selector). */
export function useRegion(): string {
  return usePreferences((s) => s.region);
}
