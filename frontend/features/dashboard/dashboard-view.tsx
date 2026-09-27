"use client";

import Link from "next/link";
import { ArrowRight, Boxes, Globe, Layers, RefreshCw, Star } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "@/components/layout/page-header";
import { ServiceIcon, SERVICE_SHORT_NAMES, serviceColor } from "@/components/aws/service-icon";
import { ExecutionStatusBadge, HttpStatusText } from "@/components/aws/status-badges";
import { FavoriteToggle } from "@/features/services/favorite-toggle";
import { useDashboard, useServices, useTarget, useTargetStatus } from "@/hooks/use-queries";
import { useHydrated } from "@/hooks/use-hydrated";
import { usePreferences } from "@/stores/preferences";
import { formatDuration, formatRelative } from "@/lib/format";
import type { LogEntry } from "@/types/api";

export function DashboardView() {
  const qc = useQueryClient();
  const dashboard = useDashboard();
  const target = useTarget();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["target"] });
    qc.invalidateQueries({ queryKey: ["services"] });
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          target.isAws
            ? `Your AWS account${target.accountId ? ` ${target.accountId}` : ""}, operated with the credentials of the Go API.`
            : "Welcome to your local AWS environment powered by Floci."
        }
        breadcrumbs={[{ label: "AWS Local Console", href: "/dashboard" }, { label: "Dashboard" }]}
        actions={
          <Button onClick={refresh} loading={dashboard.isFetching && !dashboard.isPending}>
            {!(dashboard.isFetching && !dashboard.isPending) && <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </Button>
        }
      />

      {dashboard.isError && <ErrorAlert error={dashboard.error} className="mb-4" />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Services"
          value={dashboard.data?.serviceCount}
          hint={dashboard.data && target.target ? `${dashboard.data.availableServiceCount} available on ${target.name}` : undefined}
          href="/services"
          icon={<Layers className="size-5" />}
          loading={dashboard.isPending}
        />
        <StatCard
          label="Resources"
          value={dashboard.data?.resourceCount}
          hint={dashboard.data ? `across ${dashboard.data.resourcesByService.filter((r) => r.count > 0).length} services` : undefined}
          href="/resources"
          icon={<Boxes className="size-5" />}
          loading={dashboard.isPending}
        />
        <StatCard
          label="Regions"
          value={dashboard.data?.regionCount}
          hint="Selectable in the top bar"
          href="/settings"
          icon={<Globe className="size-5" />}
          loading={dashboard.isPending}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <RecentOperations loading={dashboard.isPending} failed={dashboard.isError} operations={dashboard.data?.recentOperations} />
          <ResourcesByService loading={dashboard.isPending} failed={dashboard.isError} data={dashboard.data?.resourcesByService} errors={dashboard.data?.errors} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TargetStatusPanel />
          <FavoritesPanel />
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, hint, href, icon, loading }: { label: string; value?: number; hint?: string; href: string; icon: ReactNode; loading: boolean }) {
  const id = `stat-${label.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="group relative rounded-2xl border border-aws-border bg-aws-surface px-5 py-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <h2 id={id} className="text-sm font-bold text-aws-muted">
          <Link href={href} className="text-aws-muted no-underline after:absolute after:inset-0 group-hover:text-aws-link">
            {label}
          </Link>
        </h2>
        <span className="flex size-9 items-center justify-center rounded-full bg-aws-panel text-aws-muted group-hover:bg-aws-info-bg group-hover:text-aws-link" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="mt-1 text-4xl leading-none font-light text-aws-ink tabular-nums" data-testid={`${id}-value`}>
        {loading ? <span className="inline-block h-9 w-14 animate-pulse rounded bg-aws-panel" aria-label="Loading" /> : (value ?? "-")}
      </p>
      <p className="mt-2 text-xs text-aws-muted">{hint ?? " "}</p>
    </section>
  );
}

function RecentOperations({ loading, failed, operations }: { loading: boolean; failed: boolean; operations?: LogEntry[] }) {
  return (
    <Panel
      title="Recent Operations"
      count={operations?.length}
      actions={
        <Link href="/logs" className="flex items-center gap-1 text-sm font-bold">
          View all logs <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
      bodyClassName="px-0 py-0"
    >
      {loading ? (
        <Loading className="px-5" />
      ) : failed ? (
        <Unavailable />
      ) : !operations?.length ? (
        <EmptyState title="No operations yet" description="Operations executed from the consoles, the API Explorer or the CLI appear here." action={<Link href="/api-explorer">Open API Explorer</Link>} />
      ) : (
        <Table className="[&_td]:align-middle" aria-label="Recent operations">
          <thead>
            <tr>
              <Th className="pl-5">Service</Th>
              <Th>Operation</Th>
              <Th>Status</Th>
              <Th className="text-right">HTTP</Th>
              <Th className="text-right">Duration</Th>
              <Th className="pr-5 text-right">When</Th>
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => (
              <Tr key={op.id}>
                <Td className="pl-5">
                  <span className="flex items-center gap-2">
                    <ServiceIcon service={op.service} size="sm" />
                    <span className="font-bold">{SERVICE_SHORT_NAMES[op.service] ?? op.service}</span>
                  </span>
                </Td>
                <Td>
                  <Link href={`/logs?id=${encodeURIComponent(op.id)}`} className="font-mono text-[13px]">
                    {op.operation}
                  </Link>
                </Td>
                <Td>
                  <ExecutionStatusBadge status={op.status} />
                </Td>
                <Td className="text-right">
                  <HttpStatusText code={op.httpStatus} />
                </Td>
                <Td className="text-right text-aws-muted tabular-nums">{formatDuration(op.durationMs)}</Td>
                <Td className="pr-5 text-right whitespace-nowrap text-aws-muted" title={op.timestamp}>
                  {formatRelative(op.timestamp)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function ResourcesByService({
  loading,
  failed,
  data,
  errors = [],
}: {
  loading: boolean;
  failed: boolean;
  data?: { service: string; count: number }[];
  errors?: { service: string; message: string }[];
}) {
  const rows = (data ?? []).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel title="Resources by service" actions={<Link href="/resources" className="flex items-center gap-1 text-sm font-bold">Resource Explorer <ArrowRight className="size-3.5" aria-hidden /></Link>}>
      {loading ? (
        <Loading />
      ) : failed ? (
        <Unavailable />
      ) : rows.length === 0 && errors.length > 0 ? (
        <EmptyState
          title="Resources could not be listed"
          description={`Listing failed for ${errors.map((e) => e.service).join(", ")}.`}
          action={<Link href="/resources">See the errors in the Resource Explorer</Link>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No resources yet" description="Create a bucket, queue, table or function to see it here." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.service} className="grid grid-cols-[11rem_1fr_3rem] items-center gap-3 text-sm">
              <Link href={`/services/${r.service}?tab=resources`} className="flex items-center gap-2 text-aws-ink no-underline hover:text-aws-link">
                <ServiceIcon service={r.service} size="sm" />
                <span className="truncate font-bold">{SERVICE_SHORT_NAMES[r.service] ?? r.service}</span>
              </Link>
              <span className="h-2 overflow-hidden rounded-full bg-aws-panel" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: serviceColor(r.service) }} />
              </span>
              <span className="text-right font-bold tabular-nums">{r.count}</span>
            </li>
          ))}
          {errors.length > 0 && (
            <li className="text-sm text-aws-muted">
              {errors.length} service{errors.length === 1 ? "" : "s"} could not be listed ({errors.map((e) => e.service).join(", ")}); details in the <Link href="/resources">Resource Explorer</Link>.
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

function TargetStatusPanel() {
  const status = useTargetStatus();
  const running = status.data?.services.filter((s) => s.status === "running" || s.status === "available").length;
  const name = status.data?.name ?? "Target";
  return (
    <section aria-label={`${name} Status`}>
      <Panel title={`${name} Status`} actions={<Link href="/settings" className="text-sm font-bold">Details</Link>}>
        {status.isPending ? (
          <Loading />
        ) : status.isError ? (
          <ErrorAlert error={status.error} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className={`flex size-10 items-center justify-center rounded-full ${status.data.healthy ? "bg-aws-success-bg" : "bg-aws-error-bg"}`} aria-hidden>
                <span className={`size-3 rounded-full ${status.data.healthy ? "bg-aws-green" : "bg-aws-red"}`} />
              </span>
              <div>
                <p className="text-xs text-aws-muted">{status.data.name}</p>
                <p className={`text-lg leading-tight font-bold ${status.data.healthy ? "text-aws-green" : "text-aws-red"}`}>{status.data.status}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {status.data.target === "aws" ? (
                <>
                  <dt className="text-aws-muted">Account</dt>
                  <dd className="font-mono text-[13px]">{status.data.accountId || "-"}</dd>
                  <dt className="text-aws-muted">Identity</dt>
                  <dd className="truncate font-mono text-[13px]" title={status.data.identityArn ?? status.data.error}>
                    {status.data.identityArn ?? "-"}
                  </dd>
                  <dt className="text-aws-muted">Region</dt>
                  <dd className="font-mono text-[13px]">{status.data.region}</dd>
                </>
              ) : (
                <>
                  <dt className="text-aws-muted">Endpoint</dt>
                  <dd className="truncate font-mono text-[13px]" title={status.data.endpoint}>
                    {status.data.endpoint}
                  </dd>
                  <dt className="text-aws-muted">Version</dt>
                  <dd>{status.data.version ?? "-"}</dd>
                  {status.data.edition && (
                    <>
                      <dt className="text-aws-muted">Edition</dt>
                      <dd className="capitalize">{status.data.edition}</dd>
                    </>
                  )}
                </>
              )}
              <dt className="text-aws-muted">Latency</dt>
              <dd className="tabular-nums">{status.data.latencyMs}ms</dd>
              {status.data.target === "floci" && (
                <>
                  <dt className="text-aws-muted">Services</dt>
                  <dd>{status.data.services.length ? `${running} of ${status.data.services.length} running` : "-"}</dd>
                </>
              )}
            </dl>
            {status.data.error && status.data.target === "aws" && <p className="text-sm break-words text-aws-red">{status.data.error}</p>}
          </div>
        )}
      </Panel>
    </section>
  );
}

function FavoritesPanel() {
  const hydrated = useHydrated();
  const favorites = usePreferences((s) => s.favorites);
  const services = useServices();
  const list = hydrated ? favorites : [];
  return (
    <section aria-label="Favorites">
      <Panel title="Favorites" count={hydrated ? list.length : undefined}>
        {!hydrated || services.isPending ? (
          <Loading />
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Star className="size-6 text-aws-border-strong" aria-hidden />
            <p className="font-bold">No favorites yet</p>
            <p className="text-sm text-aws-muted">
              Use the star on a service in <Link href="/services">Services</Link> to pin it here.
            </p>
          </div>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {list.map((id) => {
              const s = services.data?.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-aws-panel">
                  <ServiceIcon service={id} category={s?.category} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/services/${id}`} className="block truncate font-bold">
                      {s?.shortName ?? SERVICE_SHORT_NAMES[id] ?? id}
                    </Link>
                    <p className="truncate text-xs text-aws-muted">{s?.name ?? id}</p>
                  </div>
                  <FavoriteToggle serviceId={id} label={s?.shortName ?? id} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function Unavailable() {
  return <p className="px-5 py-8 text-center text-sm text-aws-muted">Data unavailable while the Go API is unreachable.</p>;
}
