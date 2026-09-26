"use client";

import { Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useAwsLoader } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import { isFifo, loadQueues, type QueueSummary } from "./sqs-utils";

export function QueueList() {
  const { navigate } = useConsoleNav();
  const queues = useAwsLoader(["sqs", "queues"], loadQueues);

  return (
    <>
      <ResourceTable<QueueSummary>
        title="Queues"
        items={queues.data}
        loading={queues.isLoading}
        fetching={queues.isFetching}
        error={queues.error}
        onRefresh={() => queues.refetch()}
        actions={
          <Button variant="primary" onClick={() => navigate({ view: "create" })}>
            <Plus className="size-4" aria-hidden />
            Create queue
          </Button>
        }
        rowKey={(q) => q.url}
        filterText={(q) => q.name}
        searchPlaceholder="Search queues by prefix"
        emptyTitle="No queues"
        emptyDescription="You don't have any queues yet. Create a queue to start sending messages."
        columns={[
          { header: "Name", cell: (q) => <ConsoleLink to={{ resource: q.name }}>{q.name}</ConsoleLink> },
          { header: "Type", cell: (q) => (isFifo(q.name) ? <Badge tone="blue">FIFO</Badge> : <Badge>Standard</Badge>) },
          { header: "Created", cell: (q) => formatDateTime(q.attributes.CreatedTimestamp), className: "whitespace-nowrap" },
          { header: "Messages available", cell: (q) => q.attributes.ApproximateNumberOfMessages ?? "-", className: "text-right" },
          { header: "Messages in flight", cell: (q) => q.attributes.ApproximateNumberOfMessagesNotVisible ?? "-", className: "text-right" },
        ]}
      />
    </>
  );
}
