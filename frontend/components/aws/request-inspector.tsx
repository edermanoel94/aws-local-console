"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Clock } from "lucide-react";
import type { ExecuteResponse, ExecutionError, LogEntry } from "@/types/api";
import { OperationError } from "@/lib/api";
import { CodeBlock, CopyButton, ErrorAlert, JsonView, Tabs } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDuration } from "@/lib/format";
import { ExecutionStatusBadge } from "./status-badges";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "./service-icon";

/** Common shape of an executed operation (ExecuteResponse or LogEntry). */
export interface InspectedExecution {
  id: string;
  service: string;
  operation: string;
  region: string;
  status: ExecuteResponse["status"];
  httpStatus: number;
  durationMs: number;
  requestId?: string;
  timestamp: string;
  source?: LogEntry["source"];
  resourceName?: string;
  request: ExecuteResponse["request"];
  response: ExecuteResponse["response"];
  error?: ExecutionError;
}

export function fromExecuteResponse(r: ExecuteResponse): InspectedExecution {
  return { ...r };
}

export function fromLogEntry(l: LogEntry): InspectedExecution {
  return {
    ...l,
    error: l.status === "error" ? { kind: l.errorKind ?? "aws", code: l.errorCode ?? "Error", message: l.errorMessage ?? "" } : undefined,
  };
}

type TabValue = "request" | "response" | "headers";

/**
 * Request Inspector: summary (service, operation, status, duration, request id), error, and the
 * Request / Response / Headers tabs. Summary texts follow the contract ("Status: 200", "Duration: 14ms").
 */
export function RequestInspector({ execution: e, showLogLink = true, defaultTab = "response" }: { execution: InspectedExecution; showLogLink?: boolean; defaultTab?: TabValue }) {
  const [tab, setTab] = useState<TabValue>(e.status === "error" && !e.response.output ? "request" : defaultTab);
  const errorForAlert = e.error
    ? new OperationError({
        id: e.id,
        service: e.service,
        operation: e.operation,
        region: e.region,
        status: e.status,
        httpStatus: e.httpStatus,
        durationMs: e.durationMs,
        timestamp: e.timestamp,
        request: e.request,
        response: e.response,
        error: e.error,
      })
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-aws-border bg-aws-panel/60 px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <ServiceIcon service={e.service} size="sm" />
          <span className="font-bold">{SERVICE_SHORT_NAMES[e.service] ?? e.service}</span>
          <span className="font-mono text-[13px]">{e.operation}</span>
        </span>
        <ExecutionStatusBadge status={e.status} />
        <p>
          Status: <strong className={cn("font-mono", e.status === "success" ? "text-aws-green" : "text-aws-red")}>{e.httpStatus}</strong>
        </p>
        <p className="flex items-center gap-1">
          <Clock className="size-3.5 text-aws-muted" aria-hidden />
          Duration: <strong className="tabular-nums">{formatDuration(e.durationMs)}</strong>
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Service">{SERVICE_SHORT_NAMES[e.service] ? `${SERVICE_SHORT_NAMES[e.service]} (${e.service})` : e.service}</Field>
        <Field label="Operation">
          <span className="font-mono text-[13px]">{e.operation}</span>
        </Field>
        <Field label="Region">{e.region}</Field>
        <Field label="Request ID">{e.requestId ? <CopyText text={e.requestId} /> : <span className="text-aws-muted">Not returned</span>}</Field>
        <Field label="Timestamp">{formatDateTime(e.timestamp)}</Field>
        {e.source && <Field label="Source">{e.source}</Field>}
        {e.resourceName && <Field label="Resource">{e.resourceName}</Field>}
        <Field label="Log ID">
          {showLogLink ? (
            <Link href={`/logs/${encodeURIComponent(e.id)}`} className="font-mono text-[13px]">
              {e.id}
            </Link>
          ) : (
            <span className="font-mono text-[13px]">{e.id}</span>
          )}
        </Field>
      </dl>

      {errorForAlert && <ErrorAlert error={errorForAlert} />}

      <div>
        <Tabs<TabValue>
          label="Inspector sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "request", label: "Request" },
            { value: "response", label: "Response" },
            { value: "headers", label: "Headers" },
          ]}
        />
        <div role="tabpanel" aria-label={tab === "request" ? "Request" : tab === "response" ? "Response" : "Headers"} className="pt-4">
          {tab === "request" && (
            <div className="flex flex-col gap-3">
              {(e.request.method || e.request.url) && (
                <p className="flex min-w-0 items-center gap-2 rounded-lg border border-aws-border px-3 py-2 font-mono text-[13px]">
                  {e.request.method && <span className="rounded bg-aws-navy px-1.5 py-0.5 text-[11px] font-bold text-white">{e.request.method}</span>}
                  <span className="min-w-0 break-all">{e.request.url}</span>
                </p>
              )}
              <Section title="Parameters">
                <JsonView value={e.request.input ?? {}} label="Request parameters" />
              </Section>
            </div>
          )}
          {tab === "response" && (
            <div className="flex flex-col gap-3">
              <Section title="Output">
                {e.response.output === undefined || e.response.output === null ? (
                  <p className="rounded-lg border border-dashed border-aws-border-strong px-3 py-4 text-sm text-aws-muted">No output{e.error ? " (the call failed)" : ""}.</p>
                ) : (
                  <JsonView value={e.response.output} label="Response body" />
                )}
              </Section>
              {e.response.body && (
                <Section title="Raw error body">
                  <CodeBlock text={e.response.body} label="Raw error body" className="max-h-72 leading-normal whitespace-pre-wrap" />
                </Section>
              )}
            </div>
          )}
          {tab === "headers" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Section title="Request headers">
                <HeaderTable headers={e.request.headers} />
              </Section>
              <Section title="Response headers">
                <HeaderTable headers={e.response.headers} />
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-aws-muted">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-bold tracking-wide text-aws-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function HeaderTable({ headers }: { headers?: Record<string, string> }) {
  const entries = Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className="rounded-lg border border-dashed border-aws-border-strong px-3 py-4 text-sm text-aws-muted">No headers captured.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-aws-border">
      <table className="w-full text-[13px]">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-aws-border last:border-0">
              <th scope="row" className="w-2/5 bg-aws-panel/60 px-3 py-1.5 text-left align-top font-mono font-bold break-all">
                {k}
              </th>
              <td className="px-3 py-1.5 font-mono break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate font-mono text-[13px]" title={text}>
        {text}
      </span>
      <CopyButton value={text} label="Copy request id" className="size-5" />
    </span>
  );
}
