"use client";

import { useState } from "react";
import { Badge, Button, ConfirmDeleteDialog, ErrorAlert, Loading, Panel, Tabs } from "@/components/ui";
import { useAwsLoader, useConsoleAction } from "../_shared/aws";
import { ConfirmDialog, CopyableText } from "../_shared/controls";
import { formatBytes, formatDateTime, formatSeconds } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { TagsPanel } from "../_shared/tags-panel";
import { SendReceive } from "./send-receive";
import { EditQueueAttributes } from "./edit-attributes";
import { LambdaTriggers } from "../_shared/lambda-triggers";
import { isFifo, loadQueue, type QueueInfo } from "./sqs-utils";

type QueueTab = "messages" | "configuration" | "triggers" | "tags";

const TABS: { value: QueueTab; label: string }[] = [
  { value: "messages", label: "Send and receive messages" },
  { value: "configuration", label: "Configuration" },
  { value: "triggers", label: "Lambda triggers" },
  { value: "tags", label: "Tagging" },
];

export function QueueDetail({ queueName }: { queueName: string }) {
  const { detail, navigate } = useConsoleNav();
  const tab: QueueTab = TABS.some((t) => t.value === detail) ? (detail as QueueTab) : "messages";
  const queue = useAwsLoader(["sqs", "queue", queueName], (exec) => loadQueue(exec, queueName));
  const [dialog, setDialog] = useState<"delete" | "purge" | null>(null);
  const url = queue.data?.url;

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("sqs", "DeleteQueue", { QueueUrl: url }),
    successMessage: () => `Queue ${queueName} deleted`,
    onSuccess: () => navigate({}),
  });
  const purge = useConsoleAction({
    run: (_: void, exec) => exec("sqs", "PurgeQueue", { QueueUrl: url }),
    successMessage: () => `Queue ${queueName} purged`,
    onSuccess: () => setDialog(null),
  });

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Queues", to: {} }, { label: queueName }]}
        title={queueName}
        badge={isFifo(queueName) ? <Badge tone="blue">FIFO</Badge> : <Badge>Standard</Badge>}
        actions={
          <>
            <Button onClick={() => setDialog("purge")} disabled={!url}>
              Purge
            </Button>
            <Button variant="danger" onClick={() => setDialog("delete")} disabled={!url}>
              Delete
            </Button>
          </>
        }
      />
      {queue.error ? (
        <ErrorAlert error={queue.error} />
      ) : queue.isLoading || !queue.data ? (
        <Loading />
      ) : (
        <>
          <QueueSummaryPanel name={queueName} queue={queue.data} />
          <Tabs label="Queue sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: queueName, detail: t })} />
          {tab === "messages" && <SendReceive queueName={queueName} queueUrl={queue.data.url} contentBasedDeduplication={queue.data.attributes.ContentBasedDeduplication === "true"} />}
          {tab === "configuration" && <EditQueueAttributes queueName={queueName} queue={queue.data} />}
          {tab === "triggers" && (
            <LambdaTriggers eventSourceArn={queue.data.attributes.QueueArn ?? ""} description="Functions invoked with batches of messages from this queue. Add triggers from the Lambda console." />
          )}
          {tab === "tags" && (
            <TagsPanel
              queryKey={["sqs-queue", queueName]}
              load={async (exec) => {
                const out = await exec<{ Tags?: Record<string, string> | null }>("sqs", "ListQueueTags", { QueueUrl: queue.data.url });
                return Object.entries(out.Tags ?? {}).map(([key, value]) => ({ key, value }));
              }}
              save={async (exec, rows, previous) => {
                const removed = previous.filter((p) => !rows.some((r) => r.key.trim() === p.key)).map((p) => p.key);
                if (removed.length) await exec("sqs", "UntagQueue", { QueueUrl: queue.data.url, TagKeys: removed });
                if (rows.length) await exec("sqs", "TagQueue", { QueueUrl: queue.data.url, Tags: Object.fromEntries(rows.map((r) => [r.key.trim(), r.value])) });
              }}
              successMessage={`Tags of queue ${queueName} saved`}
            />
          )}
        </>
      )}

      <ConfirmDeleteDialog
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="queue"
        resourceName={queueName}
        loading={remove.isPending}
        error={remove.error}
      />
      <ConfirmDialog
        open={dialog === "purge"}
        onClose={() => {
          setDialog(null);
          purge.reset();
        }}
        onConfirm={() => purge.mutate()}
        title="Purge queue"
        confirmLabel="Confirm purge"
        confirmText="purge"
        loading={purge.isPending}
        error={purge.error}
      >
        <p>
          Purging <strong className="break-all">{queueName}</strong> permanently deletes all messages in the queue. This action cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

function deadLetterQueueName(redrivePolicy: string | undefined): string {
  try {
    const arn = (JSON.parse(redrivePolicy ?? "") as { deadLetterTargetArn?: string }).deadLetterTargetArn;
    return arn ? (arn.split(":").pop() ?? arn) : "-";
  } catch {
    return "-";
  }
}

function QueueSummaryPanel({ name, queue }: { name: string; queue: QueueInfo }) {
  const a = queue.attributes;
  return (
    <Panel title="Details">
      <DetailsGrid
        columns={4}
        items={[
          { label: "Name", value: name },
          { label: "Type", value: isFifo(name) ? "FIFO" : "Standard" },
          { label: "ARN", value: a.QueueArn ? <CopyableText value={a.QueueArn} label="Copy queue ARN" /> : "-" },
          { label: "URL", value: <CopyableText value={queue.url} label="Copy queue URL" /> },
          { label: "Created", value: formatDateTime(a.CreatedTimestamp) },
          { label: "Last updated", value: formatDateTime(a.LastModifiedTimestamp) },
          { label: "Messages available", value: a.ApproximateNumberOfMessages ?? "0" },
          { label: "Messages in flight", value: a.ApproximateNumberOfMessagesNotVisible ?? "0" },
          { label: "Messages delayed", value: a.ApproximateNumberOfMessagesDelayed ?? "0" },
          { label: "Visibility timeout", value: formatSeconds(a.VisibilityTimeout) },
          { label: "Message retention period", value: formatSeconds(a.MessageRetentionPeriod) },
          { label: "Maximum message size", value: a.MaximumMessageSize ? formatBytes(Number(a.MaximumMessageSize)) : "-" },
          { label: "Delivery delay", value: formatSeconds(a.DelaySeconds) },
          { label: "Receive message wait time", value: formatSeconds(a.ReceiveMessageWaitTimeSeconds) },
          { label: "Dead-letter queue", value: deadLetterQueueName(a.RedrivePolicy) },
          ...(isFifo(name) ? [{ label: "Content-based deduplication", value: a.ContentBasedDeduplication === "true" ? "Enabled" : "Disabled" }] : []),
        ]}
      />
    </Panel>
  );
}
