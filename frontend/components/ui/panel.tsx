import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** AWS-console style container with a header (title, counter, actions). */
export function Panel({
  title,
  count,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-aws-border bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-aws-border px-5 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-lg font-bold text-aws-ink">
                {title}
                {count !== undefined && <span className="ml-1 font-normal text-aws-muted">({count})</span>}
              </h2>
            )}
            {description && <p className="text-sm text-aws-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}
