"use client";

import { EmptyState, ErrorAlert, Loading, Panel } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { RefreshButton } from "../_shared/resource-table";
import { logGroupOf, type FunctionConfiguration } from "./lambda-types";

interface FilteredEvents {
  Events?: { EventId?: string; Timestamp?: number; Message?: string; LogStreamName?: string }[] | null;
}

function isMissingGroup(err: unknown) {
  return err instanceof Error && err.message.startsWith("ResourceNotFoundException");
}

/** Recent CloudWatch Logs events of the function's log group. */
export function LogsTab({ fn }: { fn: FunctionConfiguration }) {
  const group = logGroupOf(fn);
  const logs = useAwsQuery<FilteredEvents>("logs", "FilterLogEvents", { LogGroupName: group, Limit: 500 }, { retry: false });
  const events = [...(logs.data?.Events ?? [])].sort((a, b) => (b.Timestamp ?? 0) - (a.Timestamp ?? 0));

  return (
    <Panel
      title="Log events"
      count={logs.data ? events.length : undefined}
      description={
        <>
          Latest events of the CloudWatch Logs group <span className="font-mono text-xs">{group}</span>, newest first.
        </>
      }
      bodyClassName="px-0! py-0!"
      actions={<RefreshButton onClick={() => logs.refetch()} spinning={logs.isFetching} />}
    >
      {logs.isLoading ? (
        <Loading className="px-5" />
      ) : logs.error && !isMissingGroup(logs.error) ? (
        <div className="px-5 py-4">
          <ErrorAlert error={logs.error} />
        </div>
      ) : events.length === 0 ? (
        <EmptyState title="No log events" description="Invoke the function from the Test tab to produce logs." />
      ) : (
        <ol aria-label="Log events" className="divide-y divide-aws-border font-mono text-xs">
          {events.map((e, i) => (
            <li key={e.EventId ?? i} className="grid gap-x-4 gap-y-1 px-5 py-2 md:grid-cols-[170px_1fr]">
              <time className="whitespace-nowrap text-aws-muted">{formatDateTime(e.Timestamp)}</time>
              <span className="leading-5 break-all whitespace-pre-wrap">{(e.Message ?? "").trimEnd()}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
