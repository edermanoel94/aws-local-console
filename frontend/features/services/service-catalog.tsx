"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ServiceCategory, ServiceSummary } from "@/types/api";
import { EmptyState, ErrorAlert, Loading } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { CATEGORY_COLORS, CATEGORY_ICONS, ServiceIcon } from "@/components/aws/service-icon";
import { AvailabilityBadge, CoverageBar } from "@/components/aws/status-badges";
import { useServices } from "@/hooks/use-queries";
import { FavoriteToggle } from "./favorite-toggle";

export const CATEGORIES: ServiceCategory[] = [
  "Compute",
  "Storage",
  "Database",
  "Networking",
  "Security",
  "Application Integration",
  "Management",
  "Analytics",
];

export function ServiceCatalog() {
  const services = useServices();
  const [query, setQuery] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      (services.data ?? []).filter(
        (s) =>
          (!availableOnly || s.available) &&
          (!q || [s.id, s.name, s.shortName, s.description, s.category].some((f) => f.toLowerCase().includes(q))),
      ),
    [services.data, q, availableOnly],
  );

  const total = services.data?.length ?? 0;
  const available = services.data?.filter((s) => s.available).length ?? 0;

  return (
    <>
      <PageHeader
        title="Services"
        description="All AWS services registered in the console, grouped by category."
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Services" }]}
      />

      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-2xl border border-aws-border bg-white px-5 py-4 shadow-sm">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="service-search" className="text-sm font-bold">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-aws-muted" aria-hidden />
            <input
              id="service-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find services by name, id or category"
              className="h-9 w-full rounded-lg border border-aws-border-strong bg-white pr-3 pl-8 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
            />
          </div>
        </div>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} className="size-4 accent-aws-link" />
          Available only
        </label>
        {services.data && (
          <p className="ml-auto flex h-9 items-center text-sm text-aws-muted">
            <span className="font-bold text-aws-ink">{available}</span>&nbsp;of {total} services available on Floci
          </p>
        )}
      </div>

      {services.isPending ? (
        <Loading />
      ) : services.isError ? (
        <ErrorAlert error={services.error} />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-aws-border bg-white">
          <EmptyState title="No services match" description={`Nothing matches "${query}". Try a different name or clear the filters.`} />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {CATEGORIES.map((category) => {
            const items = filtered.filter((s) => s.category === category);
            if (items.length === 0 && (q || availableOnly)) return null;
            return <CategorySection key={category} category={category} services={items} />;
          })}
        </div>
      )}
    </>
  );
}

function CategorySection({ category, services }: { category: ServiceCategory; services: ServiceSummary[] }) {
  const id = `category-${category.toLowerCase().replace(/\s+/g, "-")}`;
  const Icon = CATEGORY_ICONS[category];
  return (
    <section aria-labelledby={id} className="flex flex-col rounded-2xl border border-aws-border bg-white shadow-sm">
      <h2 id={id} className="flex items-center gap-2 border-b border-aws-border px-5 py-3 text-base font-bold text-aws-ink">
        <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `${CATEGORY_COLORS[category]}1a` }} aria-hidden>
          <Icon className="size-3.5" style={{ color: CATEGORY_COLORS[category] }} />
        </span>
        {category}
        <span className="font-normal text-aws-muted">({services.length})</span>
      </h2>
      {services.length === 0 ? (
        <p className="px-5 py-4 text-sm text-aws-muted">No services registered in this category yet.</p>
      ) : (
        <ul className="divide-y divide-aws-border">
          {services.map((s) => (
            <li key={s.id}>
              <ServiceRow service={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ServiceRow({ service: s }: { service: ServiceSummary }) {
  return (
    <article className="group relative flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-aws-panel/60">
      <ServiceIcon service={s.id} category={s.category} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[15px] leading-tight font-bold">
            <Link href={`/services/${s.id}`} className="text-aws-ink no-underline group-hover:text-aws-link after:absolute after:inset-0">
              {s.shortName}
            </Link>
          </h3>
          <span className="truncate text-xs text-aws-muted">{s.name}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm text-aws-muted" title={s.description}>
          {s.description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <AvailabilityBadge available={s.available} />
          <span className="text-xs text-aws-muted">
            <span className="font-bold text-aws-ink tabular-nums">{s.operationCount}</span> operations
          </span>
          <CoverageBar coverage={s.coverage} compact className="min-w-40 flex-1" />
        </div>
      </div>
      <FavoriteToggle serviceId={s.id} label={s.shortName} className="-mt-1 -mr-1" />
    </article>
  );
}
