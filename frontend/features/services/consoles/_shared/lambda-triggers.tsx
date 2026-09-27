"use client";

import { Badge } from "@/components/ui";
import { nameFromArn, useAwsQuery } from "./aws";
import { formatDateTime } from "./format";
import { ResourceTable } from "./resource-table";

interface Mapping {
  UUID: string;
  FunctionArn: string;
  State?: string;
  BatchSize?: number;
  StartingPosition?: string;
  LastModified?: string;
}

/** Where a stream trigger starts reading (CreateEventSourceMapping StartingPosition). */
export const STARTING_POSITIONS = [
  { value: "LATEST", label: "Latest", description: "Only records written after the trigger is created." },
  { value: "TRIM_HORIZON", label: "Trim horizon", description: "Every record still in the stream, oldest first." },
] as const;

export function startingPositionLabel(value: string | undefined): string {
  return STARTING_POSITIONS.find((p) => p.value === value)?.label ?? value ?? "-";
}

/** Lambda functions consuming an event source (event source mappings of a queue or stream). */
export function LambdaTriggers({ eventSourceArn, description, stream }: { eventSourceArn: string; description: string; stream?: boolean }) {
  const mappings = useAwsQuery<{ EventSourceMappings?: Mapping[] | null }>("lambda", "ListEventSourceMappings", { EventSourceArn: eventSourceArn }, { enabled: !!eventSourceArn });
  return (
    <ResourceTable<Mapping>
      title="Lambda triggers"
      description={description}
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
        ...(stream ? [{ header: "Starting position", cell: (m: Mapping) => startingPositionLabel(m.StartingPosition) }] : []),
        { header: "UUID", cell: (m) => <span className="font-mono text-xs">{m.UUID}</span> },
        { header: "Last modified", cell: (m) => formatDateTime(m.LastModified), className: "whitespace-nowrap" },
      ]}
    />
  );
}
