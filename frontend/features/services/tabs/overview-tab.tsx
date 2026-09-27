"use client";

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { ServiceDetail } from "@/types/api";
import { Badge, EmptyState, ErrorAlert, Loading, Panel } from "@/components/ui";
import { AvailabilityBadge, CoverageBar, ExecutionStatusBadge } from "@/components/aws/status-badges";
import { useLogs, useServiceResources, useTarget } from "@/hooks/use-queries";
import { formatRelative } from "@/lib/format";

type Tab = "overview" | "resources" | "operations" | "api-explorer" | "activity" | "coverage";

export function OverviewTab({ service: s, onNavigate }: { service: ServiceDetail; onNavigate: (tab: Tab) => void }) {
  const hasResources = s.capabilities.includes("resources");
  const resources = useServiceResources(s.id, { enabled: hasResources });
  const logs = useLogs({ service: s.id, limit: 6 });
  const { isFloci } = useTarget();
  const total = s.coverage.supported + s.coverage.unsupported + s.coverage.untested;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        <Panel title="Service details">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Name">{s.name}</Item>
            <Item label="Short name">{s.shortName}</Item>
            <Item label="Service id">
              <span className="font-mono text-[13px]">{s.id}</span>
            </Item>
            <Item label="Category">{s.category}</Item>
            <Item label="Availability">
              <AvailabilityBadge available={s.available} />
            </Item>
            <Item label="Operations">{s.operationCount}</Item>
            <Item label="Resource types">{s.resourceTypes.length ? s.resourceTypes.join(", ") : "-"}</Item>
            <Item label="Capabilities">
              <span className="flex flex-wrap gap-1">
                {s.capabilities.length ? s.capabilities.map((c) => <Badge key={c}>{c}</Badge>) : "-"}
              </span>
            </Item>
          </dl>
        </Panel>

        {hasResources && (
          <Panel title="Resources" count={resources.data?.resources.length} actions={<LinkButton onClick={() => onNavigate("resources")}>Manage resources</LinkButton>}>
            {resources.isPending ? (
              <Loading />
            ) : resources.isError ? (
              <ErrorAlert error={resources.error} />
            ) : resources.data.resources.length === 0 ? (
              <EmptyState title={`No ${s.resourceTypes[0] ?? "resource"}s yet`} description={`Create one from the Resources tab.`} />
            ) : (
              <ul className="divide-y divide-aws-border">
                {resources.data.resources.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate font-bold">{r.name}</span>
                    <span className="truncate font-mono text-[11px] text-aws-muted">{r.arn}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {isFloci && (
          <Panel title="Coverage" actions={<LinkButton onClick={() => onNavigate("coverage")}>Details</LinkButton>}>
            <p className="mb-2 text-3xl font-light tabular-nums">
              {total ? Math.round((s.coverage.supported / total) * 100) : 0}%
              <span className="ml-2 text-sm text-aws-muted">verified supported</span>
            </p>
            <CoverageBar coverage={s.coverage} />
          </Panel>
        )}

        <Panel title="Recent activity" actions={<LinkButton onClick={() => onNavigate("activity")}>View all</LinkButton>}>
          {logs.isPending ? (
            <Loading />
          ) : logs.isError ? (
            <ErrorAlert error={logs.error} />
          ) : logs.data.length === 0 ? (
            <p className="py-4 text-center text-sm text-aws-muted">No activity for {s.shortName} yet.</p>
          ) : (
            <ul className="divide-y divide-aws-border">
              {logs.data.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate font-mono text-[13px]">{l.operation}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <ExecutionStatusBadge status={l.status} />
                    <span className="w-14 text-right text-xs text-aws-muted">{formatRelative(l.timestamp)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-aws-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-sm font-bold text-aws-link hover:underline">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </button>
  );
}
