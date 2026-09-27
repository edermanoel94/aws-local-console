"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, ErrorAlert, SelectField, TextField } from "@/components/ui";
import { eventSourceName, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { Checkbox, ConfirmDialog, RadioCards, RemoveIconButton } from "../_shared/controls";
import { formatDateTime } from "../_shared/format";
import { STARTING_POSITIONS, startingPositionLabel } from "../_shared/lambda-triggers";
import { useQueueOptions, useStreamOptions } from "../_shared/pickers";
import { ResourceTable } from "../_shared/resource-table";
import { requiredInt } from "../_shared/validation";
import type { EventSourceMapping, FunctionConfiguration } from "./lambda-types";

function sourceService(arn = "") {
  if (arn.startsWith("arn:aws:sqs:")) return "SQS";
  if (arn.includes(":dynamodb:")) return "DynamoDB";
  if (arn.startsWith("arn:aws:kinesis:")) return "Kinesis";
  return "-";
}

export function TriggersTab({ fn }: { fn: FunctionConfiguration }) {
  const mappings = useAwsQuery<{ EventSourceMappings?: EventSourceMapping[] | null }>("lambda", "ListEventSourceMappings", { FunctionName: fn.FunctionName });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EventSourceMapping | null>(null);

  const toggle = useConsoleAction<EventSourceMapping>({
    run: (m, exec) => exec("lambda", "UpdateEventSourceMapping", { UUID: m.UUID, Enabled: m.State !== "Enabled" }),
    successMessage: (m) => `Trigger ${m.State === "Enabled" ? "disabled" : "enabled"}`,
  });
  const remove = useConsoleAction<EventSourceMapping>({
    run: (m, exec) => exec("lambda", "DeleteEventSourceMapping", { UUID: m.UUID }),
    successMessage: () => "Trigger deleted",
    onSuccess: () => setRemoving(null),
  });

  return (
    <>
      <ResourceTable<EventSourceMapping>
        title="Triggers"
        description="Event source mappings that poll a queue or stream and invoke this function with batches of records."
        items={mappings.data ? (mappings.data.EventSourceMappings ?? []) : undefined}
        loading={mappings.isLoading}
        fetching={mappings.isFetching}
        error={mappings.error ?? toggle.error}
        onRefresh={() => mappings.refetch()}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            Add trigger
          </Button>
        }
        rowKey={(m) => m.UUID}
        filterText={(m) => `${m.EventSourceArn ?? ""} ${m.UUID}`}
        searchPlaceholder="Find triggers"
        emptyTitle="No triggers"
        emptyDescription="Add a trigger to invoke this function with messages from an SQS queue or changes from a DynamoDB stream."
        columns={[
          { header: "Source", cell: (m) => <Badge tone="blue">{sourceService(m.EventSourceArn)}</Badge> },
          {
            header: "Event source",
            cell: (m) => (
              <span className="flex flex-col">
                <span className="font-bold">{eventSourceName(m.EventSourceArn ?? "")}</span>
                <span className="font-mono text-xs break-all text-aws-muted">{m.EventSourceArn}</span>
              </span>
            ),
          },
          { header: "State", cell: (m) => <Badge tone={m.State === "Enabled" ? "green" : "gray"}>{m.State ?? "-"}</Badge> },
          { header: "Batch size", cell: (m) => m.BatchSize ?? "-" },
          { header: "Starting position", cell: (m) => startingPositionLabel(m.StartingPosition) },
          { header: "Last modified", cell: (m) => formatDateTime(m.LastModified), className: "whitespace-nowrap" },
          {
            header: "Actions",
            className: "w-px whitespace-nowrap text-right",
            cell: (m) => (
              <span className="flex items-center justify-end gap-1">
                <Button size="sm" onClick={() => toggle.mutate(m)} loading={toggle.isPending && toggle.variables?.UUID === m.UUID}>
                  {m.State === "Enabled" ? "Disable" : "Enable"}
                </Button>
                <RemoveIconButton label={`Delete trigger ${eventSourceName(m.EventSourceArn ?? m.UUID)}`} onClick={() => setRemoving(m)} />
              </span>
            ),
          },
        ]}
      />
      {adding && <AddTriggerDialog fn={fn} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Delete trigger"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete the trigger from <strong className="break-all">{eventSourceName(removing?.EventSourceArn ?? "")}</strong>? The function stops receiving its records.
        </p>
      </ConfirmDialog>
    </>
  );
}

const triggerSchema = z
  .object({
    source: z.enum(["sqs", "dynamodb"]),
    queueArn: z.string(),
    streamArn: z.string(),
    startingPosition: z.enum(["LATEST", "TRIM_HORIZON"]),
    batchSize: requiredInt(1, 10000, "Batch size"),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.source === "sqs" && !v.queueArn.startsWith("arn:aws:sqs:")) ctx.addIssue({ code: "custom", path: ["queueArn"], message: "Choose an SQS queue." });
    if (v.source === "dynamodb" && !v.streamArn.includes("/stream/")) ctx.addIssue({ code: "custom", path: ["streamArn"], message: "Choose a DynamoDB table." });
  });

type TriggerValues = z.infer<typeof triggerSchema>;

function pickerOptions(picker: { isLoading: boolean; data?: { value: string; label: string }[] }, noun: string, empty: string) {
  const placeholder = picker.isLoading ? `Loading ${noun}s...` : (picker.data?.length ?? 0) === 0 ? empty : `Choose a ${noun}`;
  return [{ value: "", label: placeholder }, ...(picker.data ?? [])];
}

function AddTriggerDialog({ fn, onClose }: { fn: FunctionConfiguration; onClose: () => void }) {
  const form = useForm<TriggerValues>({
    resolver: zodResolver(triggerSchema),
    defaultValues: { source: "sqs", queueArn: "", streamArn: "", startingPosition: "LATEST", batchSize: "10", enabled: true },
  });
  const source = useWatch({ control: form.control, name: "source" });
  const queues = useQueueOptions(source === "sqs");
  const streams = useStreamOptions(source === "dynamodb");
  const add = useConsoleAction<TriggerValues>({
    run: (v, exec) =>
      exec("lambda", "CreateEventSourceMapping", {
        FunctionName: fn.FunctionName,
        EventSourceArn: v.source === "sqs" ? v.queueArn : v.streamArn,
        BatchSize: Number(v.batchSize),
        Enabled: v.enabled,
        ...(v.source === "dynamodb" ? { StartingPosition: v.startingPosition } : {}),
      }),
    successMessage: (v) => `Trigger ${eventSourceName(v.source === "sqs" ? v.queueArn : v.streamArn)} added to ${fn.FunctionName}`,
    onSuccess: onClose,
  });
  const { errors } = form.formState;
  const picker = source === "sqs" ? queues : streams;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add trigger"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} onClick={form.handleSubmit((v) => add.mutate(v))}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          label="Trigger source"
          options={[
            { value: "sqs", label: "Amazon SQS" },
            { value: "dynamodb", label: "Amazon DynamoDB (stream)" },
          ]}
          {...form.register("source")}
        />
        {source === "sqs" ? (
          <SelectField key="sqs" label="SQS queue" options={pickerOptions(queues, "queue", "No queues found")} error={errors.queueArn?.message} {...form.register("queueArn")} />
        ) : (
          <>
            <SelectField
              key="dynamodb"
              label="DynamoDB table"
              description="Tables with a stream turned on. Turn one on from the table's Streams tab in the DynamoDB console."
              options={pickerOptions(streams, "table", "No tables with a stream found")}
              error={errors.streamArn?.message}
              {...form.register("streamArn")}
            />
            <Controller
              control={form.control}
              name="startingPosition"
              render={({ field }) => <RadioCards legend="Starting position" name="starting-position" value={field.value} onChange={field.onChange} options={[...STARTING_POSITIONS]} />}
            />
          </>
        )}
        <TextField
          label="Batch size"
          inputMode="numeric"
          description={source === "sqs" ? "The maximum number of messages per invocation (1 to 10,000)." : "The maximum number of stream records per invocation (1 to 10,000)."}
          error={errors.batchSize?.message}
          {...form.register("batchSize")}
        />
        <Checkbox label="Activate trigger" description={source === "sqs" ? "Start polling the queue immediately." : "Start reading the stream immediately."} {...form.register("enabled")} />
        {(add.error || picker.error) && <ErrorAlert error={add.error ?? picker.error} />}
      </div>
    </Dialog>
  );
}
