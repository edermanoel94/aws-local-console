"use client";

import { Fragment, Suspense, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button, ErrorAlert, Loading } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useConsoleNav, type NavUpdate } from "./nav";

/** Every console renders inside this boundary (useSearchParams needs a Suspense ancestor). */
export function ConsoleRoot({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      {/* Bottom space keeps the last actions scrollable above the toast stack (bottom-right). */}
      <div className="flex flex-col gap-4 pb-32 [font-variant-ligatures:none]">{children}</div>
    </Suspense>
  );
}

/** In-console link: a real anchor (middle click works) that navigates with the history API. */
export function ConsoleLink({
  to,
  children,
  className,
  reset = true,
  ...rest
}: { to: NavUpdate; children: ReactNode; className?: string; reset?: boolean } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { href, navigate } = useConsoleNav();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to, { reset });
  };
  return (
    <a href={href(to, reset)} onClick={onClick} className={cn("font-bold text-aws-link hover:underline", className)} {...rest}>
      {children}
    </a>
  );
}

export interface ConsoleCrumb {
  label: string;
  to?: NavUpdate;
}

/** Title row of a console view: breadcrumbs, heading, description and actions. */
export function ConsoleHeader({
  crumbs,
  title,
  description,
  actions,
  badge,
}: {
  crumbs?: ConsoleCrumb[];
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Console breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {crumbs.map((c, i) => (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 && <ChevronRight className="size-3.5 text-aws-muted" aria-hidden />}
                <li className="min-w-0 truncate">
                  {c.to ? (
                    <ConsoleLink to={c.to} className="font-normal">
                      {c.label}
                    </ConsoleLink>
                  ) : (
                    <span className="text-aws-muted">{c.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-2xl font-bold text-aws-ink">{title}</h2>
          {badge}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-3xl text-sm text-aws-muted">{description}</p>}
    </div>
  );
}

/** Create/edit page: header, panels, error and the Cancel / submit footer (AWS "wizard" page style). */
export function FormPage({
  crumbs,
  title,
  description,
  onSubmit,
  onCancel,
  submitLabel = "Create",
  submitting,
  error,
  children,
}: {
  crumbs?: ConsoleCrumb[];
  title: string;
  description?: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  submitLabel?: string;
  submitting?: boolean;
  error?: unknown;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-4xl flex-col gap-4">
      <ConsoleHeader crumbs={crumbs} title={title} description={description} />
      {children}
      {error ? <ErrorAlert error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Label/value grid used by "Details" / "General configuration" sections. `wide` items span two columns (long ARNs). */
export function DetailsGrid({ items, columns = 3 }: { items: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }[]; columns?: 2 | 3 | 4 }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-x-8 gap-y-4",
        columns === 2 && "md:grid-cols-2",
        columns === 3 && "md:grid-cols-3",
        columns === 4 && "md:grid-cols-2 xl:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "md:col-span-2")}>
          <dt className="text-sm text-aws-muted">{item.label}</dt>
          <dd className={cn("mt-0.5 text-sm break-words text-aws-ink", item.mono && "font-mono text-xs leading-5")}>
            {item.value === undefined || item.value === null || item.value === "" ? "-" : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Small section heading inside a panel. */
export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-bold text-aws-ink">{children}</h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
