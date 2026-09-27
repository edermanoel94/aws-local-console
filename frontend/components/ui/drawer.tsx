"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "md" | "lg" | "xl";
}

/**
 * Non-modal detail panel sliding from the right (role="dialog").
 * The page stays interactive so another row can be selected while it is open; Escape closes it.
 */
export function Drawer({ open, onClose, title, subtitle, actions, children, width = "lg" }: DrawerProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        "fixed top-12 right-0 bottom-0 z-30 flex w-full flex-col border-l border-aws-border-strong bg-aws-surface shadow-2xl outline-none",
        "animate-[drawer-in_160ms_ease-out]",
        width === "md" && "max-w-md",
        width === "lg" && "max-w-2xl",
        width === "xl" && "max-w-4xl",
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-aws-border px-5 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lg font-bold text-aws-ink">
            {title}
          </h2>
          {subtitle && <div className="mt-0.5 text-xs text-aws-muted">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-aws-muted hover:bg-aws-panel hover:text-aws-ink">
            <X className="size-5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}
