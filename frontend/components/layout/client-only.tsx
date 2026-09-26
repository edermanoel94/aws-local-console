"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Renders children only after hydration.
 * Needed for data-driven features inside late-hydrating Suspense boundaries: the shared TanStack Query cache
 * may already hold data fetched by the shell, which would otherwise mismatch the server HTML.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useHydrated() ? children : fallback;
}
