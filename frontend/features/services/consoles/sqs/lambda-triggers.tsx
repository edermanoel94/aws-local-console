"use client";

import { Badge } from "@/components/ui";
import { nameFromArn, useAwsQuery } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { ResourceTable } from "../_shared/resource-table";

interface Mapping {
  UUID: string;
  FunctionArn: string;
  State?: string;
  BatchSize?: number;
  LastModified?: string;
}

/** Lambda functions consuming this queue (event source mappings). */
export function LambdaTriggers({ queueArn }: { queueArn: string }) {
  const mappings = useAwsQuery<{ EventSourceMappings?: Mapping[] | null }>("lambda", "ListEventSourceMappings", { EventSourceArn: queueArn }, { enabled: !!queueArn });
  return (
    <ResourceTable<Mapping>
      title="Lambda triggers"
      description="Functions invoked with batches of messages from this queue. Add triggers from the Lambda console."
      items={mappings.data ? (mappings.data.EventSourceMappings ?? []) : undefined}
      loading={mappings.isLoading}
      fetching={mappings.isFetching}
      error={mappings.error}
      onRefresh={() => mappings.refetch()}
      rowKey={(m) => m.UUID}
      filterText={(m) => m.FunctionArn}
      searchPlaceholder="Find triggers by function"
      emptyTitle="No Lambda triggers"
      columns={[
        { header: "Function", cell: (m) => <span className="font-bold">{nameFromArn(m.FunctionArn)}</span> },
        { header: "State", cell: (m) => <Badge tone={m.State === "Enabled" ? "green" : "gray"}>{m.State ?? "-"}</Badge> },
        { header: "Batch size", cell: (m) => m.BatchSize ?? "-" },
        { header: "UUID", cell: (m) => <span className="font-mono text-xs">{m.UUID}</span> },
        { header: "Last modified", cell: (m) => formatDateTime(m.LastModified), className: "whitespace-nowrap" },
      ]}
    />
  );
}
