"use client";

import { useCallback } from "react";

export type SearchParamsUpdate = Record<string, string | null | undefined>;

/**
 * Updates query-string params in place with `window.history.replaceState`, which Next.js syncs
 * with `useSearchParams`/`usePathname` without a navigation or server round trip.
 *
 * It always starts from the live `window.location`, never from a render-time `useSearchParams`
 * snapshot: quick successive updates (typing a search, then picking a filter) would otherwise
 * be built from a stale URL and silently drop each other's params.
 * Empty, null or undefined values remove the param.
 */
export function useUpdateSearchParams() {
  return useCallback((update: SearchParamsUpdate) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(update)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
}
