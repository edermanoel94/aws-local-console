"use client";

import { cn } from "@/lib/cn";

/** Controlled tab list with role="tablist"/role="tab" (CONTRACT section 6). Render the panel yourself. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto border-b border-aws-border", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px border-b-4 px-3 py-2 text-sm font-bold whitespace-nowrap",
            t.value === value ? "border-aws-link text-aws-link" : "border-transparent text-aws-muted hover:text-aws-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
