"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import type { LogEntry } from "@/types/api";
import { Button, Drawer, EmptyState, ErrorAlert, Loading, Panel, SelectField, Table, Td, Th, Tr } from "@/components/ui";
import { RequestInspector, fromLogEntry } from "@/components/aws/request-inspector";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { ExecutionStatusBadge, HttpStatusText } from "@/components/aws/status-badges";
import { useLog, useLogs, useService, useServices } from "@/hooks/use-queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

interface LogsExplorerProps {
  /** Restricts the view to one service (service detail "Activity" tab). */
  fixedService?: string;
  /** Keeps filters and the open log (?id=) in the URL (standalone /logs page). */
  syncUrl?: boolean;
}

const SOURCES = ["api-explorer", "console", "cli", "system"] as const;

/** Audit log table with filters, auto refresh and a Request Inspector drawer. */
export function LogsExplorer({ fixedService, syncUrl = false }: LogsExplorerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initial = (key: string) => (syncUrl ? (searchParams.get(key) ?? "") : "");

  const [service, setService] = useState(fixedService ?? initial("service"));
  const [operation, setOperation] = useState(initial("operation"));
  const [status, setStatus] = useState(initial("status"));
  const [source, setSource] = useState(initial("source"));
  const [q, setQ] = useState(initial("q"));
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selectedId = syncUrl ? searchParams.get("id") : localSelected;

  const deferredQ = useDeferredValue(q.trim());
  const deferredOperation = useDeferredValue(operation.trim());
  const query = { service: service || undefined, operation: deferredOperation || undefined, status: status || undefined, source: source || undefined, q: deferredQ || undefined, limit: 200 };
  const logs = useLogs(query, autoRefresh ? 4_000 : false);
  const services = useServices();
  const serviceDetail = useService(service || "s3");
  const operationListId = useId();

  const selectFromList = logs.data?.find((l) => l.id === selectedId);
  const fetched = useLog(selectedId && !selectFromList ? selectedId : undefined);
  const selected = selectFromList ?? fetched.data;

  const setUrl = (mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const select = (id: string | null) => {
    if (syncUrl) setUrl((p) => (id ? p.set("id", id) : p.delete("id")));
    else setLocalSelected(id);
  };
  const updateFilter = (key: string, value: string, set: (v: string) => void) => {
    set(value);
    if (syncUrl) setUrl((p) => (value ? p.set(key, value) : p.delete(key)));
  };

  const filtersActive = !!(operation || status || source || q || (!fixedService && service));
  const clearFilters = () => {
    setOperation("");
    setStatus("");
    setSource("");
    setQ("");
    if (!fixedService) setService("");
    if (syncUrl) setUrl((p) => ["service", "operation", "status", "source", "q"].forEach((k) => p.delete(k)));
  };

  const serviceOptions = useMemo(
    () => [{ value: "", label: "All services" }, ...(services.data ?? []).map((s) => ({ value: s.id, label: s.shortName }))],
    [services.data],
  );

  return (
    <>
      <Panel
        title="Operation logs"
        count={logs.data?.length}
        description="Every operation executed through the console, the API Explorer and the CLI."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-aws-link" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto refresh
            </label>
            <Button onClick={() => logs.refetch()} loading={logs.isFetching && !autoRefresh}>
              {!(logs.isFetching && !autoRefresh) && <RefreshCw className="size-4" aria-hidden />}
              Refresh
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        <div className={cn(
            "grid grid-cols-2 items-end gap-3 border-b border-aws-border px-5 py-3 md:grid-cols-3",
            fixedService ? "lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]" : "lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]",
          )}>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${operationListId}-q`} className="text-sm font-bold">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-aws-muted" aria-hidden />
              <input
                id={`${operationListId}-q`}
                type="search"
                value={q}
                onChange={(e) => updateFilter("q", e.target.value, setQ)}
                placeholder="Resource, request id, error code"
                className="h-[34px] w-full rounded-lg border border-aws-border-strong bg-white pr-3 pl-8 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
              />
            </div>
          </div>
          {!fixedService && (
            <SelectField label="Service" className="min-w-0" value={service} onChange={(e) => updateFilter("service", e.target.value, setService)} options={serviceOptions} />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${operationListId}-op`} className="text-sm font-bold">
              Operation
            </label>
            <input
              id={`${operationListId}-op`}
              list={operationListId}
              value={operation}
              onChange={(e) => updateFilter("operation", e.target.value, setOperation)}
              placeholder="Any operation"
              className="h-[34px] w-full rounded-lg border border-aws-border-strong bg-white px-2.5 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
            />
            <datalist id={operationListId}>
              {(service ? (serviceDetail.data?.operations ?? []) : []).map((o) => (
                <option key={o.name} value={o.name} />
              ))}
            </datalist>
          </div>
          <SelectField
            label="Status"
            className="min-w-0"
            value={status}
            onChange={(e) => updateFilter("status", e.target.value, setStatus)}
            options={[
              { value: "", label: "Any status" },
              { value: "success", label: "Success" },
              { value: "error", label: "Error" },
            ]}
          />
          <SelectField
            label="Source"
            className="min-w-0"
            value={source}
            onChange={(e) => updateFilter("source", e.target.value, setSource)}
            options={[{ value: "", label: "Any source" }, ...SOURCES.map((s) => ({ value: s, label: s }))]}
          />
          {filtersActive && (
            <Button variant="ghost" className="self-end" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {logs.isPending ? (
          <Loading className="px-5" />
        ) : logs.isError ? (
          <div className="p-5">
            <ErrorAlert error={logs.error} />
          </div>
        ) : logs.data.length === 0 ? (
          <EmptyState
            title={filtersActive ? "No logs match the filters" : "No logs yet"}
            description={filtersActive ? "Adjust or clear the filters." : "Execute an operation from a service console, the API Explorer or the CLI."}
          />
        ) : (
          <LogsTable logs={logs.data} selectedId={selectedId} onSelect={select} showService={!fixedService} />
        )}
      </Panel>

      <Drawer
        open={!!selectedId}
        onClose={() => select(null)}
        title={selected ? `${SERVICE_SHORT_NAMES[selected.service] ?? selected.service} ${selected.operation}` : "Log entry"}
        subtitle={selected ? formatDateTime(selected.timestamp) : undefined}
        actions={
          selectedId && (
            <Link href={`/logs/${encodeURIComponent(selectedId)}`} className="flex items-center gap-1 text-sm font-bold" title="Open as page">
              <ExternalLink className="size-3.5" aria-hidden /> Open
            </Link>
          )
        }
        width="xl"
      >
        {selected ? (
          <RequestInspector execution={fromLogEntry(selected)} showLogLink={false} defaultTab="request" />
        ) : fetched.isError ? (
          <ErrorAlert error={fetched.error} />
        ) : (
          <Loading />
        )}
      </Drawer>
    </>
  );
}

export function LogsTable({ logs, selectedId, onSelect, showService = true }: { logs: LogEntry[]; selectedId?: string | null; onSelect: (id: string) => void; showService?: boolean }) {
  return (
    <Table className="[&_td]:align-middle" aria-label="Logs">
      <thead>
        <tr>
          <Th className="pl-5">Time</Th>
          {showService && <Th>Service</Th>}
          <Th>Operation</Th>
          <Th>Status</Th>
          <Th className="text-right">HTTP</Th>
          <Th className="pr-5 text-right xl:pr-3">Duration</Th>
          <Th className="hidden xl:table-cell">Source</Th>
          <Th className="hidden pr-5 xl:table-cell">Resource</Th>
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <Tr key={l.id} selected={l.id === selectedId} className="cursor-pointer" onClick={() => onSelect(l.id)}>
            <Td className="pl-5 font-mono text-[12px] whitespace-nowrap text-aws-muted">{formatDateTime(l.timestamp)}</Td>
            {showService && (
              <Td>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <ServiceIcon service={l.service} size="sm" />
                  {SERVICE_SHORT_NAMES[l.service] ?? l.service}
                </span>
              </Td>
            )}
            <Td>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(l.id);
                }}
                className={cn("text-left font-mono text-[13px] text-aws-link hover:underline", l.id === selectedId && "font-bold")}
              >
                {l.operation}
              </button>
              {l.errorCode && <p className="mt-0.5 max-w-xs truncate text-xs text-aws-red">{l.errorCode}</p>}
            </Td>
            <Td>
              <ExecutionStatusBadge status={l.status} />
            </Td>
            <Td className="text-right">
              <HttpStatusText code={l.httpStatus} />
            </Td>
            <Td className="pr-5 text-right whitespace-nowrap text-aws-muted tabular-nums xl:pr-3">{formatDuration(l.durationMs)}</Td>
            <Td className="hidden whitespace-nowrap text-aws-muted xl:table-cell">{l.source}</Td>
            <Td className="hidden max-w-44 truncate pr-5 xl:table-cell 2xl:max-w-64" title={l.resourceName}>
              {l.resourceName ?? <span className="text-aws-muted">-</span>}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
