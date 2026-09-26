"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TopBar } from "./top-bar";
import { Sidebar, type SidebarMode } from "./sidebar";
import { GlobalSearch } from "./global-search";

const subscribeNoop = () => () => {};

function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

/** Below this width the sidebar defaults to icons only, to leave room for tables (mirrors Tailwind's `xl` breakpoint). */
const NARROW_QUERY = "(max-width: 1279px)";

/** Application chrome: fixed top bar, collapsible left sidebar, global search palette. */
export function AppShell({ children }: { children: ReactNode }) {
  // "auto" follows the viewport via CSS; the toggle button pins an explicit choice.
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("auto");
  const toggleSidebar = useCallback(() => {
    setSidebarMode((mode) => {
      const collapsedNow = mode === "auto" ? window.matchMedia(NARROW_QUERY).matches : mode === "collapsed";
      return collapsedNow ? "expanded" : "collapsed";
    });
  }, []);
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
      <TopBar onToggleSidebar={toggleSidebar} onOpenSearch={() => setSearchOpen(true)} shortcut={isMac ? "⌘ K" : "Ctrl K"} />
      <div className="flex pt-12">
        <Sidebar mode={sidebarMode} />
        <main className={cn("min-w-0 flex-1 px-6 py-5 xl:px-8")}>
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
      <GlobalSearch open={searchOpen} onClose={closeSearch} />
    </>
  );
}
