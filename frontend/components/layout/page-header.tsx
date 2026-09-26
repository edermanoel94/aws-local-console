import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumbs + page title + description + actions, AWS console style. */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  icon,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {c.href && !last ? (
                    <Link href={c.href} className="text-aws-link">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="text-aws-muted" aria-current={last ? "page" : undefined}>
                      {c.label}
                    </span>
                  )}
                  {!last && <ChevronRight className="size-3.5 text-aws-muted" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-bold text-aws-ink">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-aws-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-3">{meta}</div>}
    </div>
  );
}
