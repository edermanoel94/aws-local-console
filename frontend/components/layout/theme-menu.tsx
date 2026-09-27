"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/cn";
import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { usePreferences } from "@/stores/preferences";

export const THEME_ICONS: Record<ThemePreference, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** Top bar menu to pick the light, dark or system theme. */
export function ThemeMenu() {
  const hydrated = useHydrated();
  const stored = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  // The server renders the default; the persisted choice shows once hydrated.
  const theme: ThemePreference = hydrated ? stored : "system";
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[2];
  const Icon = THEME_ICONS[theme];

  useEffect(() => {
    if (!open) return;
    itemRefs.current[THEME_OPTIONS.findIndex((o) => o.value === theme)]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // Focus the checked item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    const move = (next: number) => itemRefs.current[(next + THEME_OPTIONS.length) % THEME_OPTIONS.length]?.focus();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(THEME_OPTIONS.length - 1);
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex size-8 items-center justify-center rounded-md border border-white/15 text-gray-300 hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aws-orange"
      >
        <Icon className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-48 rounded-xl border border-aws-border bg-aws-surface p-1 text-aws-ink shadow-xl"
        >
          {THEME_OPTIONS.map((option, i) => {
            const OptionIcon = THEME_ICONS[option.value];
            const checked = option.value === theme;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => {
                  setTheme(option.value);
                  close();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-aws-panel focus-visible:bg-aws-panel",
                  checked && "font-bold text-aws-link",
                )}
              >
                <OptionIcon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{option.label}</span>
                {checked && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
