"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TopBar } from "./top-bar";
import { Sidebar } from "./sidebar";
import { GlobalSearch } from "./global-search";

const subscribeNoop = () => () => {};

function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

const NARROW_QUERY = "(max-width: 1279px)";

function subscribeNarrow(onChange: () => void) {
  const mql = window.matchMedia(NARROW_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True below 1280px wide, where the sidebar starts collapsed (icons only) to leave room for tables. */
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/** Application chrome: fixed top bar, collapsible left sidebar, global search palette. */
export function AppShell({ children }: { children: ReactNode }) {
  const narrow = useIsNarrow();
  // null = follow the viewport; the toggle button pins an explicit choice.
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const collapsed = userCollapsed ?? narrow;
  const [searchOpen, setSearchOpen] = useState(false);
  const isMac = useIsMac();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  return (
    <>
      <TopBar onToggleSidebar={() => setUserCollapsed(!collapsed)} onOpenSearch={() => setSearchOpen(true)} shortcut={isMac ? "⌘ K" : "Ctrl K"} />
      <div className="flex pt-12">
        <Sidebar collapsed={collapsed} />
        <main className={cn("min-w-0 flex-1 px-6 py-5 xl:px-8")}>
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={closeSearch} />
    </>
  );
}
