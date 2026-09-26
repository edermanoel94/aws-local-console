"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, ErrorAlert, Loading, Panel, Table, Td, TextField, Th, Tr } from "@/components/ui";
import { type Exec, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { Checkbox, ConfirmDialog, CopyableText, RadioCards, RemoveIconButton, SuggestField } from "../_shared/controls";
import { DetailsGrid } from "../_shared/layout";
import { useFunctionOptions, useQueueOptions, useTopicOptions } from "../_shared/pickers";
import { TagsPanel } from "../_shared/tags-panel";
import type { NotificationConfiguration } from "./s3-types";
import { EVENT_TYPES } from "./s3-utils";

export function PropertiesTab({ bucket }: { bucket: string }) {
  const location = useAwsQuery<{ LocationConstraint?: string | null }>("s3", "GetBucketLocation", { Bucket: bucket });
  return (
    <>
      <Panel title="Bucket overview">
        <DetailsGrid
          items={[
            { label: "AWS Region", value: location.isLoading ? "Loading..." : location.data?.LocationConstraint || "us-east-1" },
            { label: "Amazon Resource Name (ARN)", value: <CopyableText value={`arn:aws:s3:::${bucket}`} label="Copy bucket ARN" /> },
            { label: "S3 URI", value: <CopyableText value={`s3://${bucket}`} label="Copy bucket S3 URI" /> },
          ]}
        />
      </Panel>
      <VersioningPanel bucket={bucket} />
      <NotificationsPanel bucket={bucket} />
      <TagsPanel
        title="Tags"
        queryKey={["s3-bucket", bucket]}
        load={async (exec) => {
          try {
            const out = await exec<{ TagSet?: { Key: string; Value: string }[] }>("s3", "GetBucketTagging", { Bucket: bucket });
            return (out.TagSet ?? []).map((t) => ({ key: t.Key, value: t.Value }));
          } catch (err) {
            // A bucket without tags answers NoSuchTagSet.
            if (err instanceof Error && err.message.startsWith("NoSuchTagSet")) return [];
            throw err;
          }
        }}
        save={(exec, rows) =>
          rows.length
            ? exec("s3", "PutBucketTagging", { Bucket: bucket, Tagging: { TagSet: rows.map((r) => ({ Key: r.key.trim(), Value: r.value })) } })
            : exec("s3", "DeleteBucketTagging", { Bucket: bucket })
        }
        successMessage={`Tags of bucket ${bucket} saved`}
      />
    </>
  );
}

function VersioningPanel({ bucket }: { bucket: string }) {
  const versioning = useAwsQuery<{ Status?: string | null }>("s3", "GetBucketVersioning", { Bucket: bucket });
  const status = versioning.data?.Status || "Disabled";
  const toggle = useConsoleAction<"Enabled" | "Suspended">({
    run: (next, exec) => exec("s3", "PutBucketVersioning", { Bucket: bucket, VersioningConfiguration: { Status: next } }),
    successMessage: (next) => `Bucket Versioning ${next === "Enabled" ? "enabled" : "suspended"}`,
  });
  return (
    <Panel
      title="Bucket Versioning"
      description="Keep multiple versions of an object in one bucket to recover from unintended overwrites and deletions."
      actions={
        versioning.data &&
        (status === "Enabled" ? (
          <Button loading={toggle.isPending} onClick={() => toggle.mutate("Suspended")}>
            Suspend versioning
          </Button>
        ) : (
          <Button loading={toggle.isPending} onClick={() => toggle.mutate("Enabled")}>
            Enable versioning
          </Button>
        ))
      }
    >
      {versioning.error ? (
        <ErrorAlert error={versioning.error} />
      ) : versioning.isLoading ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          <DetailsGrid items={[{ label: "Bucket Versioning", value: <Badge tone={status === "Enabled" ? "green" : "gray"}>{status}</Badge> }]} />
          {toggle.error && <ErrorAlert error={toggle.error} />}
        </div>
      )}
    </Panel>
  );
}

type DestinationType = "sqs" | "lambda" | "sns";

interface NotificationRow {
  id: string;
  events: string[];
  type: DestinationType;
  arn: string;
}

const DESTINATION_LABELS: Record<DestinationType, string> = { sqs: "SQS queue", lambda: "Lambda function", sns: "SNS topic" };

function toRows(config: NotificationConfiguration | undefined): NotificationRow[] {
  if (!config) return [];
  return [
    ...(config.QueueConfigurations ?? []).map((c, i) => ({ id: c.Id || `queue-${i + 1}`, events: c.Events, type: "sqs" as const, arn: c.QueueArn })),
    ...(config.LambdaFunctionConfigurations ?? []).map((c, i) => ({ id: c.Id || `lambda-${i + 1}`, events: c.Events, type: "lambda" as const, arn: c.LambdaFunctionArn })),
    ...(config.TopicConfigurations ?? []).map((c, i) => ({ id: c.Id || `topic-${i + 1}`, events: c.Events, type: "sns" as const, arn: c.TopicArn })),
  ];
}

/** Writes the full notification configuration (S3 replaces it as a whole). */
function saveNotifications(exec: Exec, bucket: string, rows: NotificationRow[], eventBridge: boolean) {
  const config: Record<string, unknown> = {};
  const pick = (type: DestinationType) => rows.filter((r) => r.type === type);
  if (pick("sqs").length) config.QueueConfigurations = pick("sqs").map((r) => ({ Id: r.id, QueueArn: r.arn, Events: r.events }));
  if (pick("lambda").length) config.LambdaFunctionConfigurations = pick("lambda").map((r) => ({ Id: r.id, LambdaFunctionArn: r.arn, Events: r.events }));
  if (pick("sns").length) config.TopicConfigurations = pick("sns").map((r) => ({ Id: r.id, TopicArn: r.arn, Events: r.events }));
  if (eventBridge) config.EventBridgeConfiguration = {};
  return exec("s3", "PutBucketNotificationConfiguration", { Bucket: bucket, NotificationConfiguration: config });
}

function NotificationsPanel({ bucket }: { bucket: string }) {
  const notifications = useAwsQuery<NotificationConfiguration>("s3", "GetBucketNotificationConfiguration", { Bucket: bucket });
  const rows = toRows(notifications.data);
  const eventBridge = !!notifications.data?.EventBridgeConfiguration;
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<NotificationRow | null>(null);

  const setEventBridge = useConsoleAction<boolean>({
    run: (on, exec) => saveNotifications(exec, bucket, rows, on),
    successMessage: (on) => `Amazon EventBridge notifications turned ${on ? "on" : "off"} for ${bucket}`,
  });
  const remove = useConsoleAction<NotificationRow>({
    run: (row, exec) => saveNotifications(exec, bucket, rows.filter((r) => r !== row), eventBridge),
    successMessage: (row) => `Event notification ${row.id} deleted`,
    onSuccess: () => setRemoving(null),
  });

  return (
    <>
      <Panel
        title="Amazon EventBridge"
        description="Send notifications to Amazon EventBridge for all events in this bucket."
        actions={
          notifications.data &&
          (eventBridge ? (
            <Button loading={setEventBridge.isPending} onClick={() => setEventBridge.mutate(false)}>
              Turn off EventBridge
            </Button>
          ) : (
            <Button loading={setEventBridge.isPending} onClick={() => setEventBridge.mutate(true)}>
              Turn on EventBridge
            </Button>
          ))
        }
      >
        {notifications.error ? (
          <ErrorAlert error={notifications.error} />
        ) : notifications.isLoading ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-3">
            <DetailsGrid items={[{ label: "Send notifications to Amazon EventBridge", value: <Badge tone={eventBridge ? "green" : "gray"}>{eventBridge ? "On" : "Off"}</Badge> }]} />
            {setEventBridge.error && <ErrorAlert error={setEventBridge.error} />}
          </div>
        )}
      </Panel>
      <Panel
        title="Event notifications"
        count={notifications.data ? rows.length : undefined}
        description="Send a notification to a queue, function or topic when specific events occur in this bucket."
        bodyClassName={rows.length ? "px-0! py-0!" : undefined}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!notifications.data}>
            <Plus className="size-4" aria-hidden />
            Create event notification
          </Button>
        }
      >
        {notifications.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No event notifications" description="Choose Create event notification to be notified when a specific event occurs." />
        ) : (
          <Table aria-label="Event notifications" className="[&_tbody_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                <Th className="pl-5">Name</Th>
                <Th>Event types</Th>
                <Th>Destination type</Th>
                <Th>Destination</Th>
                <Th className="pr-5">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={`${r.type}-${r.id}`}>
                  <Td className="pl-5 font-bold">{r.id}</Td>
                  <Td className="font-mono text-xs">{r.events.join(", ")}</Td>
                  <Td>{DESTINATION_LABELS[r.type]}</Td>
                  <Td className="font-mono text-xs break-all">{r.arn}</Td>
                  <Td className="pr-5 text-right">
                    <RemoveIconButton label={`Delete event notification ${r.id}`} onClick={() => setRemoving(r)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {creating && (
        <CreateNotificationDialog
          onClose={() => setCreating(false)}
          existingIds={rows.map((r) => r.id)}
          onSave={(row, exec) => saveNotifications(exec, bucket, [...rows, row], eventBridge)}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Delete event notification"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete event notification <strong>{removing?.id}</strong>? {removing ? DESTINATION_LABELS[removing.type] : ""} will stop receiving events from this bucket.
        </p>
      </ConfirmDialog>
    </>
  );
}

const notificationSchema = z.object({
  id: z.string().trim().max(255),
  events: z.array(z.string()).min(1, "Choose at least one event type."),
  type: z.enum(["sqs", "lambda", "sns"]),
  arn: z.string().trim().regex(/^arn:aws:(sqs|lambda|sns):/, "Enter the ARN of a queue, function or topic."),
});

type NotificationForm = z.infer<typeof notificationSchema>;

function CreateNotificationDialog({ onClose, onSave, existingIds }: { onClose: () => void; onSave: (row: NotificationRow, exec: Exec) => Promise<unknown>; existingIds: string[] }) {
  const form = useForm<NotificationForm>({
    resolver: zodResolver(notificationSchema),
    defaultValues: { id: "", events: ["s3:ObjectCreated:*"], type: "sqs", arn: "" },
  });
  const type = useWatch({ control: form.control, name: "type" });
  const queues = useQueueOptions(type === "sqs");
  const functions = useFunctionOptions(type === "lambda");
  const topics = useTopicOptions(type === "sns");
  const suggestions = (type === "sqs" ? queues.data : type === "lambda" ? functions.data : topics.data) ?? [];

  const save = useConsoleAction<NotificationForm>({
    run: (v, exec) => {
      let id = v.id || `${type}-notification`;
      for (let n = 2; existingIds.includes(id); n++) id = `${v.id || `${type}-notification`}-${n}`;
      return onSave({ id, events: v.events, type: v.type, arn: v.arn }, exec);
    },
    successMessage: () => "Event notification created",
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create event notification"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Event name" placeholder="object-created-to-queue" description="Optional. Generated when empty." {...form.register("id")} />
        <Controller
          control={form.control}
          name="events"
          render={({ field }) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold">Event types</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {EVENT_TYPES.map((e) => (
                  <Checkbox
                    key={e.value}
                    label={e.label}
                    description={e.value}
                    checked={field.value.includes(e.value)}
                    onChange={(ev) => field.onChange(ev.target.checked ? [...field.value, e.value] : field.value.filter((x) => x !== e.value))}
                  />
                ))}
              </div>
              {errors.events && <p className="text-xs text-aws-red">{errors.events.message}</p>}
            </fieldset>
          )}
        />
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <RadioCards
              legend="Destination"
              name="destination-type"
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                form.setValue("arn", "");
              }}
              options={[
                { value: "sqs", label: "SQS queue" },
                { value: "lambda", label: "Lambda function" },
                { value: "sns", label: "SNS topic" },
              ]}
            />
          )}
        />
        <SuggestField label="Destination ARN" placeholder={`arn:aws:${type}:...`} suggestions={suggestions} error={errors.arn?.message} {...form.register("arn")} />
        {save.error && <ErrorAlert error={save.error} />}
      </div>
    </Dialog>
  );
}
