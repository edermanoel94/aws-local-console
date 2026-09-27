"use client";

import Link from "next/link";
import { Menu, Search } from "lucide-react";
import { RegionSelector } from "./region-selector";
import { FlociStatusPill } from "./floci-status-pill";
import { ThemeMenu } from "./theme-menu";

export function TopBar({ onToggleSidebar, onOpenSearch, shortcut }: { onToggleSidebar: () => void; onOpenSearch: () => void; shortcut: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 bg-aws-navy px-3 sm:gap-3 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)]">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
        className="flex size-8 items-center justify-center rounded-md text-gray-300 hover:bg-white/10 hover:text-white"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 text-white no-underline">
        <LogoMark />
        <span className="sr-only text-[15px] font-bold tracking-tight md:not-sr-only">AWS Local Console</span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-end px-0 sm:justify-center sm:px-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={`Search services, resources, operations ${shortcut}`}
          aria-keyshortcuts="Control+K Meta+K"
          className="flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-md border border-white/20 bg-aws-squid/40 text-sm text-gray-300 hover:border-white/40 hover:text-white sm:w-full sm:max-w-xl sm:justify-start sm:px-3 sm:text-left"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden flex-1 truncate sm:block">Search services, resources, operations</span>
          <kbd className="hidden rounded border whitespace-nowrap sm:inline border-white/25 px-1.5 py-px font-sans text-[11px] leading-4 text-gray-300">{shortcut}</kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <FlociStatusPill />
        <RegionSelector />
        <ThemeMenu />
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#ff9900" />
      <path d="M8 12.5 16 8l8 4.5v7L16 24l-8-4.5z" fill="none" stroke="#232f3e" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M8 12.5 16 17l8-4.5M16 17v7" fill="none" stroke="#232f3e" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}
