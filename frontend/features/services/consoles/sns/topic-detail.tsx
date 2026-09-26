"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Send } from "lucide-react";
import { Badge, Button, ConfirmDeleteDialog, Dialog, ErrorAlert, Loading, Panel, SelectField, Tabs, TextAreaField } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { ACCOUNT_ID, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { Checkbox, ConfirmDialog, CopyableText, RemoveIconButton, SuggestField } from "../_shared/controls";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { useFunctionOptions, useQueueOptions } from "../_shared/pickers";
import { ResourceTable } from "../_shared/resource-table";
import { TagsPanel } from "../_shared/tags-panel";
import { prettyJson } from "../_shared/format";
import { jsonText } from "../_shared/validation";

type TopicTab = "subscriptions" | "details" | "tags";

const TABS: { value: TopicTab; label: string }[] = [
  { value: "subscriptions", label: "Subscriptions" },
  { value: "details", label: "Details" },
  { value: "tags", label: "Tagging" },
];

/** Policy-like attributes (Policy, DeliveryPolicy, ...) are JSON documents and read better formatted. */
function isJsonObject(value: string): boolean {
  if (!value.trim().startsWith("{")) return false;
  try {
    return typeof JSON.parse(value) === "object";
  } catch {
    return false;
  }
}

export function useTopicArn(name: string) {
  const region = useRegion();
  return `arn:aws:sns:${region}:${ACCOUNT_ID}:${name}`;
}

export function TopicDetail({ topicName }: { topicName: string }) {
  const { detail, navigate } = useConsoleNav();
  const tab: TopicTab = TABS.some((t) => t.value === detail) ? (detail as TopicTab) : "subscriptions";
  const topicArn = useTopicArn(topicName);
  const attributes = useAwsQuery<{ Attributes?: Record<string, string> }>("sns", "GetTopicAttributes", { TopicArn: topicArn });
  const [deleting, setDeleting] = useState(false);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("sns", "DeleteTopic", { TopicArn: topicArn }),
    successMessage: () => `Topic ${topicName} deleted`,
    onSuccess: () => navigate({}),
  });

  const a = attributes.data?.Attributes ?? {};
  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Topics", to: {} }, { label: topicName }]}
        title={topicName}
        badge={topicName.endsWith(".fifo") ? <Badge tone="blue">FIFO</Badge> : <Badge>Standard</Badge>}
        actions={
          <>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
            <Button variant="primary" onClick={() => navigate({ resource: topicName, view: "publish" })}>
              <Send className="size-4" aria-hidden />
              Publish message
            </Button>
          </>
        }
      />
      {attributes.error ? (
        <ErrorAlert error={attributes.error} />
      ) : attributes.isLoading ? (
        <Loading />
      ) : (
        <>
          <Panel title="Details">
            <DetailsGrid
              columns={4}
              items={[
                { label: "Name", value: topicName },
                { label: "ARN", value: <CopyableText value={topicArn} label="Copy topic ARN" /> },
                { label: "Type", value: a.FifoTopic === "true" ? "FIFO" : "Standard" },
                { label: "Display name", value: a.DisplayName },
                { label: "Topic owner", value: a.Owner ?? ACCOUNT_ID },
                { label: "Subscriptions confirmed", value: a.SubscriptionsConfirmed },
                { label: "Subscriptions pending", value: a.SubscriptionsPending },
                { label: "Subscriptions deleted", value: a.SubscriptionsDeleted },
              ]}
            />
          </Panel>
          <Tabs label="Topic sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: topicName, detail: t })} />
          {tab === "subscriptions" && <SubscriptionsTab topicArn={topicArn} />}
          {tab === "details" && (
            <Panel title="Topic attributes" bodyClassName="px-0! py-0!">
              <dl className="divide-y divide-aws-border">
                {Object.entries(a)
                  .sort(([x], [y]) => x.localeCompare(y))
                  .map(([k, v]) => (
                    <div key={k} className="grid gap-1 px-5 py-2 md:grid-cols-[280px_1fr]">
                      <dt className="text-sm text-aws-muted">{k}</dt>
                      <dd className="min-w-0 font-mono text-xs leading-5 break-all">
                        {isJsonObject(v) ? <pre className="max-h-72 overflow-auto rounded-lg border border-aws-border bg-aws-panel p-3 whitespace-pre-wrap">{prettyJson(v)}</pre> : v || "-"}
                      </dd>
                    </div>
                  ))}
              </dl>
            </Panel>
          )}
          {tab === "tags" && (
            <TagsPanel
              queryKey={["sns-topic", topicArn]}
              load={async (exec) => {
                const out = await exec<{ Tags?: { Key: string; Value: string }[] | null }>("sns", "ListTagsForResource", { ResourceArn: topicArn });
                return (out.Tags ?? []).map((t) => ({ key: t.Key, value: t.Value }));
              }}
              save={async (exec, rows, previous) => {
                const removed = previous.filter((p) => !rows.some((r) => r.key.trim() === p.key)).map((p) => p.key);
                if (removed.length) await exec("sns", "UntagResource", { ResourceArn: topicArn, TagKeys: removed });
                if (rows.length) await exec("sns", "TagResource", { ResourceArn: topicArn, Tags: rows.map((r) => ({ Key: r.key.trim(), Value: r.value })) });
              }}
              successMessage={`Tags of topic ${topicName} saved`}
            />
          )}
        </>
      )}
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="topic"
        resourceName={topicName}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

interface Subscription {
  SubscriptionArn: string;
  Protocol: string;
  Endpoint: string;
  Owner?: string;
}

function SubscriptionsTab({ topicArn }: { topicArn: string }) {
  const subs = useAwsQuery<{ Subscriptions?: Subscription[] | null }>("sns", "ListSubscriptionsByTopic", { TopicArn: topicArn });
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Subscription | null>(null);
  const remove = useConsoleAction<Subscription>({
    run: (s, exec) => exec("sns", "Unsubscribe", { SubscriptionArn: s.SubscriptionArn }),
    successMessage: () => "Subscription deleted",
    onSuccess: () => setRemoving(null),
  });

  return (
    <>
      <ResourceTable<Subscription>
        title="Subscriptions"
        items={subs.data ? (subs.data.Subscriptions ?? []) : undefined}
        loading={subs.isLoading}
        fetching={subs.isFetching}
        error={subs.error}
        onRefresh={() => subs.refetch()}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Create subscription
          </Button>
        }
        rowKey={(s) => s.SubscriptionArn}
        filterText={(s) => `${s.Protocol} ${s.Endpoint} ${s.SubscriptionArn}`}
        searchPlaceholder="Search subscriptions"
        emptyTitle="No subscriptions"
        emptyDescription="Create a subscription to deliver messages published to this topic to a queue, function or endpoint."
        columns={[
          { header: "ID", cell: (s) => <span className="font-mono text-xs break-all">{s.SubscriptionArn.split(":").pop()}</span> },
          { header: "Protocol", cell: (s) => <Badge tone="blue">{s.Protocol.toUpperCase()}</Badge> },
          { header: "Endpoint", cell: (s) => <span className="font-mono text-xs break-all">{s.Endpoint}</span> },
          { header: "Status", cell: (s) => (s.SubscriptionArn === "PendingConfirmation" ? <Badge tone="orange">Pending confirmation</Badge> : <Badge tone="green">Confirmed</Badge>) },
          {
            header: "Actions",
            className: "w-px text-right",
            cell: (s) => <RemoveIconButton label={`Delete subscription ${s.Endpoint}`} onClick={() => setRemoving(s)} />,
          },
        ]}
      />
      {creating && <CreateSubscriptionDialog topicArn={topicArn} onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => removing && remove.mutate(removing)}
        title="Delete subscription"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete the {removing?.Protocol.toUpperCase()} subscription to <strong className="break-all">{removing?.Endpoint}</strong>? It will stop receiving messages from this topic.
        </p>
      </ConfirmDialog>
    </>
  );
}

const PROTOCOLS = [
  { value: "sqs", label: "Amazon SQS" },
  { value: "lambda", label: "AWS Lambda" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "email", label: "Email" },
  { value: "email-json", label: "Email-JSON" },
  { value: "sms", label: "SMS" },
];

const subscriptionSchema = z
  .object({
    protocol: z.string(),
    endpoint: z.string().trim().min(1, "Enter an endpoint."),
    raw: z.boolean(),
    filterPolicy: jsonText("Filter policy", { object: true, optional: true }),
  })
  .superRefine((v, ctx) => {
    if (v.protocol === "sqs" && !v.endpoint.startsWith("arn:aws:sqs:")) ctx.addIssue({ code: "custom", path: ["endpoint"], message: "Enter the ARN of an SQS queue." });
    if (v.protocol === "lambda" && !v.endpoint.startsWith("arn:aws:lambda:")) ctx.addIssue({ code: "custom", path: ["endpoint"], message: "Enter the ARN of a Lambda function." });
    if ((v.protocol === "http" || v.protocol === "https") && !v.endpoint.startsWith(`${v.protocol}://`)) ctx.addIssue({ code: "custom", path: ["endpoint"], message: `Enter a URL starting with ${v.protocol}://.` });
  });

type SubscriptionValues = z.infer<typeof subscriptionSchema>;

function CreateSubscriptionDialog({ topicArn, onClose }: { topicArn: string; onClose: () => void }) {
  const form = useForm<SubscriptionValues>({ resolver: zodResolver(subscriptionSchema), defaultValues: { protocol: "sqs", endpoint: "", raw: false, filterPolicy: "" } });
  const protocol = useWatch({ control: form.control, name: "protocol" });
  const queues = useQueueOptions(protocol === "sqs");
  const functions = useFunctionOptions(protocol === "lambda");
  const suggestions = (protocol === "sqs" ? queues.data : protocol === "lambda" ? functions.data : []) ?? [];

  const create = useConsoleAction<SubscriptionValues>({
    run: (v, exec) => {
      const attributes: Record<string, string> = {};
      if (v.raw) attributes.RawMessageDelivery = "true";
      if (v.filterPolicy.trim()) attributes.FilterPolicy = v.filterPolicy.trim();
      return exec("sns", "Subscribe", {
        TopicArn: topicArn,
        Protocol: v.protocol,
        Endpoint: v.endpoint,
        ReturnSubscriptionArn: true,
        ...(Object.keys(attributes).length ? { Attributes: attributes } : {}),
      });
    },
    successMessage: (v) => `Subscription to ${v.endpoint} created`,
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create subscription"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField label="Protocol" options={PROTOCOLS} {...form.register("protocol", { onChange: () => form.setValue("endpoint", "") })} />
        <SuggestField
          label="Endpoint"
          placeholder={protocol === "sqs" ? "arn:aws:sqs:us-east-1:000000000000:my-queue" : protocol === "lambda" ? "arn:aws:lambda:us-east-1:000000000000:function:my-function" : "https://example.com/hook"}
          description={protocol === "sqs" ? "ARN of the queue that receives the messages." : protocol === "lambda" ? "ARN of the function invoked for each message." : undefined}
          suggestions={suggestions}
          error={errors.endpoint?.message}
          {...form.register("endpoint")}
        />
        {(protocol === "sqs" || protocol === "http" || protocol === "https") && (
          <Controller
            control={form.control}
            name="raw"
            render={({ field }) => (
              <Checkbox label="Enable raw message delivery" description="Deliver the message body as-is instead of the SNS JSON envelope." checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />
            )}
          />
        )}
        <TextAreaField label="Subscription filter policy - optional" rows={4} placeholder='{"eventType": ["order_placed"]}' error={errors.filterPolicy?.message} {...form.register("filterPolicy")} />
        {create.error && <ErrorAlert error={create.error} />}
      </div>
    </Dialog>
  );
}
