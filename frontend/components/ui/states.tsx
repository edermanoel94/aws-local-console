import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Loading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="progressbar" aria-label={label} className={cn("flex items-center gap-2 py-6 text-sm text-aws-muted", className)}>
      <span className="size-4 animate-spin rounded-full border-2 border-aws-border-strong border-t-aws-link" aria-hidden />
      {label}...
    </div>
  );
}

/** Empty state. `title` must start with "No " (CONTRACT section 6). */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-bold text-aws-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-aws-muted">{description}</p>}
      {action}
    </div>
  );
}
