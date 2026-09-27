"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * URL state of a service console, kept in the query string next to the page's own `?tab=`.
 * - `view`: "create" or any console specific page ("send", "publish", ...); absent = list or detail
 * - `resource`: selected resource name (detail page)
 * - `detail`: sub-tab inside the detail page
 * - `item`: selected child item (object key, rule, ...)
 * - `prefix`: folder prefix / secondary scope (S3 prefix, EventBridge bus, ...)
 */
export const CONSOLE_PARAMS = ["view", "resource", "detail", "item", "prefix"] as const;
export type ConsoleParam = (typeof CONSOLE_PARAMS)[number];

export type NavUpdate = Partial<Record<ConsoleParam, string | null>>;

export function useConsoleNav() {
  const searchParams = useSearchParams();

  // `base` defaults to the rendered URL (for link hrefs); navigate() passes the live URL instead,
  // so quick successive navigations never build on a stale snapshot.
  const href = useCallback(
    (update: NavUpdate, reset = true, base: string = searchParams.toString()) => {
      const params = new URLSearchParams(base);
      if (reset) for (const key of CONSOLE_PARAMS) if (!(key in update)) params.delete(key);
      for (const [key, value] of Object.entries(update)) {
        if (value === null || value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      return query ? `?${query}` : "?";
    },
    [searchParams],
  );

  /** Navigates inside the console. By default every console param not in `update` is cleared. */
  const navigate = useCallback(
    (update: NavUpdate, options?: { replace?: boolean; reset?: boolean }) => {
      const url = href(update, options?.reset ?? true, window.location.search);
      if (options?.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [href],
  );

  return {
    view: searchParams.get("view"),
    resource: searchParams.get("resource"),
    detail: searchParams.get("detail"),
    item: searchParams.get("item"),
    prefix: searchParams.get("prefix"),
    navigate,
    href,
  };
}
