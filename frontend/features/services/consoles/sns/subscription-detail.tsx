"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Badge, Button, CodeBlock, Dialog, EmptyState, ErrorAlert, Loading, Panel, SelectField, TextAreaField, TextField } from "@/components/ui";
import { useAwsLoader, useConsoleAction } from "../_shared/aws";
import { Checkbox, ConfirmDialog, CopyableText, RadioCards } from "../_shared/controls";
import { prettyJson } from "../_shared/format";
import { ConsoleHeader, ConsoleLink, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { useQueueOptions } from "../_shared/pickers";
import { jsonText } from "../_shared/validation";
import { getSubscriptionAttributes, subscriptionId } from "./subscriptions";

/** Protocols that support raw message delivery. */
const RAW_DELIVERY_PROTOCOLS = ["sqs", "http", "https", "firehose"];

const SCOPES = [
  { value: "MessageAttributes", label: "Message attributes", description: "Filter on the message attributes of published messages." },
  { value: "MessageBody", label: "Message body", description: "Filter on the JSON body (payload) of published messages." },
] as const;

type Scope = (typeof SCOPES)[number]["value"];

/** An empty object is how AWS removes a filter policy, and what Floci reports afterwards. */
function hasFilterPolicy(policy: string | undefined): policy is string {
  return !!policy && policy.trim() !== "" && policy.trim() !== "{}";
}

function deadLetterQueue(redrivePolicy: string | undefined): string | undefined {
  if (!redrivePolicy?.trim()) return undefined;
  try {
    return (JSON.parse(redrivePolicy) as { deadLetterTargetArn?: string }).deadLetterTargetArn;
  } catch {
    return undefined;
  }
}

/** Accepts the bare token or the whole SubscribeURL of the SubscriptionConfirmation message. */
export function confirmationToken(text: string): string {
  const value = text.trim();
  if (!value.includes("Token=")) return value;
  try {
    return new URL(value).searchParams.get("Token") ?? value;
  } catch {
    return /[?&]Token=([^&]+)/.exec(value)?.[1] ?? value;
  }
}

export function SubscriptionDetail({ topicName, subscriptionArn }: { topicName: string; subscriptionArn: string }) {
  const { navigate } = useConsoleNav();
  const attributes = useAwsLoader(["sns", "subscription", subscriptionArn], (exec) => getSubscriptionAttributes(exec, subscriptionArn));
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("sns", "Unsubscribe", { SubscriptionArn: subscriptionArn }),
    successMessage: () => "Subscription deleted",
    onSuccess: () => navigate({ resource: topicName }),
  });

  const a = attributes.data ?? {};
  const pending = a.PendingConfirmation === "true";
  const id = subscriptionId(subscriptionArn);
  const dlq = deadLetterQueue(a.RedrivePolicy);

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Topics", to: {} }, { label: topicName, to: { resource: topicName } }, { label: `Subscription ${id}` }]}
        title={`Subscription ${id}`}
        badge={attributes.data && (pending ? <Badge tone="orange">Pending confirmation</Badge> : <Badge tone="green">Confirmed</Badge>)}
        actions={
          <>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
            {pending && <Button onClick={() => setConfirming(true)}>Confirm subscription</Button>}
            <Button variant="primary" onClick={() => setEditing(true)} disabled={!attributes.data}>
              Edit
            </Button>
          </>
        }
      />
      {attributes.error ? (
        <ErrorAlert error={attributes.error} />
      ) : attributes.isLoading || !attributes.data ? (
        <Loading />
      ) : (
        <>
          <Panel title="Details">
            <DetailsGrid
              items={[
                { label: "ARN", value: <CopyableText value={subscriptionArn} label="Copy subscription ARN" />, wide: true },
                { label: "Status", value: pending ? "Pending confirmation" : "Confirmed" },
                { label: "Endpoint", value: a.Endpoint, mono: true, wide: true },
                { label: "Protocol", value: a.Protocol?.toUpperCase() },
                { label: "Topic", value: <ConsoleLink to={{ resource: topicName }}>{topicName}</ConsoleLink> },
                { label: "Subscription owner", value: a.Owner },
                { label: "Raw message delivery", value: RAW_DELIVERY_PROTOCOLS.includes(a.Protocol ?? "") ? (a.RawMessageDelivery === "true" ? "Enabled" : "Disabled") : "Not supported" },
              ]}
            />
          </Panel>
          <Panel
            title="Subscription filter policy"
            description={hasFilterPolicy(a.FilterPolicy) ? `Scope: ${SCOPES.find((s) => s.value === (a.FilterPolicyScope || "MessageAttributes"))?.label}.` : undefined}
          >
            {hasFilterPolicy(a.FilterPolicy) ? (
              <CodeBlock text={prettyJson(a.FilterPolicy)} label="Filter policy" className="max-h-80 leading-normal whitespace-pre-wrap" />
            ) : (
              <EmptyState title="No filter policy" description="Every message published to the topic is delivered to this subscription." />
            )}
          </Panel>
          <Panel title="Redrive policy (dead-letter queue)">
            {dlq ? (
              <DetailsGrid items={[{ label: "Dead-letter queue", value: <CopyableText value={dlq} label="Copy dead-letter queue ARN" />, wide: true }]} />
            ) : (
              <EmptyState title="No dead-letter queue" description="Messages that can't be delivered after the retries of the delivery policy are discarded." />
            )}
          </Panel>
        </>
      )}
      {editing && attributes.data && <EditSubscriptionDialog subscriptionArn={subscriptionArn} attributes={attributes.data} onClose={() => setEditing(false)} />}
      {confirming && a.TopicArn && <ConfirmSubscriptionDialog topicArn={a.TopicArn} onClose={() => setConfirming(false)} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete subscription"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>
          Delete the {a.Protocol?.toUpperCase()} subscription to <strong className="break-all">{a.Endpoint}</strong>? It will stop receiving messages from this topic.
        </p>
      </ConfirmDialog>
    </>
  );
}

const editSchema = z.object({
  raw: z.boolean(),
  scope: z.enum(["MessageAttributes", "MessageBody"]),
  filterPolicy: jsonText("Filter policy", { object: true, optional: true }),
  deadLetterQueue: z.string(),
});

type EditValues = z.infer<typeof editSchema>;

function EditSubscriptionDialog({ subscriptionArn, attributes, onClose }: { subscriptionArn: string; attributes: Record<string, string>; onClose: () => void }) {
  const rawSupported = RAW_DELIVERY_PROTOCOLS.includes(attributes.Protocol ?? "");
  const currentDlq = deadLetterQueue(attributes.RedrivePolicy) ?? "";
  const queues = useQueueOptions();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      raw: attributes.RawMessageDelivery === "true",
      scope: (attributes.FilterPolicyScope as Scope) || "MessageAttributes",
      filterPolicy: hasFilterPolicy(attributes.FilterPolicy) ? prettyJson(attributes.FilterPolicy) : "",
      deadLetterQueue: currentDlq,
    },
  });

  const save = useConsoleAction<EditValues>({
    run: async (v, exec) => {
      // SetSubscriptionAttributes changes one attribute per call: send only what changed.
      const changes: [string, string][] = [];
      if (rawSupported && v.raw !== (attributes.RawMessageDelivery === "true")) changes.push(["RawMessageDelivery", String(v.raw)]);
      const policy = v.filterPolicy.trim() ? JSON.stringify(JSON.parse(v.filterPolicy)) : "";
      const currentPolicy = hasFilterPolicy(attributes.FilterPolicy) ? JSON.stringify(JSON.parse(attributes.FilterPolicy)) : "";
      if (policy) {
        // The scope decides how the policy is validated, so it goes first.
        if (v.scope !== (attributes.FilterPolicyScope || "MessageAttributes")) changes.push(["FilterPolicyScope", v.scope]);
        if (policy !== currentPolicy) changes.push(["FilterPolicy", policy]);
      } else if (currentPolicy) {
        changes.push(["FilterPolicy", "{}"]);
      }
      if (v.deadLetterQueue !== currentDlq) changes.push(["RedrivePolicy", v.deadLetterQueue ? JSON.stringify({ deadLetterTargetArn: v.deadLetterQueue }) : ""]);
      for (const [name, value] of changes) {
        await exec("sns", "SetSubscriptionAttributes", { SubscriptionArn: subscriptionArn, AttributeName: name, AttributeValue: value });
      }
      return changes.length;
    },
    successMessage: (_, changed) => (changed ? "Subscription saved" : "No changes to save"),
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  const queueOptions = [{ value: "", label: queues.isLoading ? "Loading queues..." : "None" }, ...(queues.data ?? [])];
  // Keep the current DLQ selectable even when it is not in the list (e.g. a queue in another account).
  if (currentDlq && !queueOptions.some((o) => o.value === currentDlq)) queueOptions.push({ value: currentDlq, label: currentDlq });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit subscription"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {rawSupported && <Checkbox label="Enable raw message delivery" description="Deliver the message body as-is instead of the SNS JSON envelope." {...form.register("raw")} />}
        <div className="flex flex-col gap-3">
          <Controller
            control={form.control}
            name="scope"
            render={({ field }) => <RadioCards legend="Filter policy scope" name="filter-policy-scope" value={field.value} onChange={field.onChange} options={[...SCOPES]} />}
          />
          <TextAreaField
            label="Subscription filter policy - optional"
            description="Leave empty to deliver every message."
            rows={8}
            placeholder='{"eventType": ["order_placed"]}'
            error={errors.filterPolicy?.message}
            {...form.register("filterPolicy")}
          />
        </div>
        <SelectField
          label="Dead-letter queue - optional"
          description="SQS queue that receives the messages SNS fails to deliver to this endpoint."
          options={queueOptions}
          {...form.register("deadLetterQueue")}
        />
        {(save.error || queues.error) && <ErrorAlert error={save.error ?? queues.error} />}
      </div>
    </Dialog>
  );
}

const confirmSchema = z.object({ token: z.string().trim().min(1, "Enter the token or the SubscribeURL.") });

function ConfirmSubscriptionDialog({ topicArn, onClose }: { topicArn: string; onClose: () => void }) {
  const form = useForm<{ token: string }>({ resolver: zodResolver(confirmSchema), defaultValues: { token: "" } });
  const confirm = useConsoleAction<{ token: string }>({
    run: (v, exec) => exec("sns", "ConfirmSubscription", { TopicArn: topicArn, Token: confirmationToken(v.token) }),
    successMessage: () => "Subscription confirmed",
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Confirm subscription"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={confirm.isPending} onClick={form.handleSubmit((v) => confirm.mutate(v))}>
            Confirm subscription
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-aws-muted">
          SNS sent a SubscriptionConfirmation message to the endpoint. Paste its Token, or its whole SubscribeURL. Endpoints on your machine are reachable from Floci at host.docker.internal.
        </p>
        <TextField label="Token or SubscribeURL" autoComplete="off" error={form.formState.errors.token?.message} {...form.register("token")} />
        {confirm.error && <ErrorAlert error={confirm.error} />}
      </div>
    </Dialog>
  );
}
