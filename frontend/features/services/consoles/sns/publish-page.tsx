"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ErrorAlert, Loading, Panel, TextAreaField, TextField } from "@/components/ui";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { KeyValueEditor, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { useTopicArn } from "./topic-detail";

/** FIFO topics need a group ID, and a deduplication ID unless content-based deduplication is enabled (SNS rejects the message otherwise). */
const schema = (fifo: boolean, contentBasedDeduplication: boolean) =>
  z
    .object({
      subject: z.string().trim().max(100, "Subjects can be up to 100 characters."),
      body: z.string().min(1, "Enter a message body."),
      groupId: z.string().trim(),
      deduplicationId: z.string().trim(),
    })
    .refine((v) => !fifo || v.groupId !== "", { path: ["groupId"], message: "Message group ID is required for FIFO topics." })
    .refine((v) => !fifo || contentBasedDeduplication || v.deduplicationId !== "", {
      path: ["deduplicationId"],
      message: "Message deduplication ID is required because content-based deduplication is disabled for this topic.",
    });

type FormValues = z.infer<ReturnType<typeof schema>>;

export function PublishPage({ topicName }: { topicName: string }) {
  const topicArn = useTopicArn(topicName);
  const fifo = topicName.endsWith(".fifo");
  // Standard topics need nothing from the topic configuration; FIFO topics need to know the deduplication mode.
  const attributes = useAwsQuery<{ Attributes?: Record<string, string> }>("sns", "GetTopicAttributes", { TopicArn: topicArn }, { enabled: fifo });
  if (fifo && attributes.error) return <ErrorAlert error={attributes.error} />;
  if (fifo && !attributes.data) return <Loading />;
  return <PublishForm topicName={topicName} topicArn={topicArn} fifo={fifo} contentBasedDeduplication={attributes.data?.Attributes?.ContentBasedDeduplication === "true"} />;
}

function PublishForm({ topicName, topicArn, fifo, contentBasedDeduplication }: { topicName: string; topicArn: string; fifo: boolean; contentBasedDeduplication: boolean }) {
  const { navigate } = useConsoleNav();
  const [attributes, setAttributes] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema(fifo, contentBasedDeduplication)), defaultValues: { subject: "", body: "", groupId: "", deduplicationId: "" } });
  const back = () => navigate({ resource: topicName });

  const publish = useConsoleAction<FormValues, { MessageId?: string }>({
    run: (v, exec) => {
      const messageAttributes = Object.fromEntries(attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim(), { DataType: "String", StringValue: a.value }]));
      return exec("sns", "Publish", {
        TopicArn: topicArn,
        Message: v.body,
        ...(v.subject ? { Subject: v.subject } : {}),
        ...(fifo ? { MessageGroupId: v.groupId } : {}),
        ...(fifo && v.deduplicationId ? { MessageDeduplicationId: v.deduplicationId } : {}),
        ...(Object.keys(messageAttributes).length ? { MessageAttributes: messageAttributes } : {}),
      });
    },
    successMessage: (_, out) => `Message published to topic ${topicName}${out.MessageId ? ` (ID ${out.MessageId})` : ""}`,
    onSuccess: back,
  });

  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "Topics", to: {} }, { label: topicName, to: { resource: topicName } }, { label: "Publish message" }]}
      title="Publish message to topic"
      description={<span className="font-mono text-xs">{topicArn}</span>}
      onSubmit={form.handleSubmit((v) => publish.mutate(v))}
      onCancel={back}
      submitLabel="Publish message"
      submitting={publish.isPending}
      error={publish.error}
    >
      <Panel title="Message details">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Subject - optional" placeholder="Order update" error={errors.subject?.message} {...form.register("subject")} />
          {fifo && (
            <>
              <TextField label="Message group ID" placeholder="group-1" error={errors.groupId?.message} {...form.register("groupId")} />
              <TextField
                label="Message deduplication ID"
                placeholder={contentBasedDeduplication ? "Optional (content-based deduplication is enabled)" : "dedup-1"}
                error={errors.deduplicationId?.message}
                {...form.register("deduplicationId")}
              />
            </>
          )}
        </div>
      </Panel>
      <Panel title="Message body" description="The same payload is delivered to every subscription.">
        <TextAreaField label="Message body" rows={8} placeholder='{"orderId": "1234", "status": "PAID"}' error={errors.body?.message} {...form.register("body")} />
      </Panel>
      <Panel title="Message attributes - optional" description="String attributes used by subscription filter policies.">
        <KeyValueEditor rows={attributes} onChange={setAttributes} keyLabel="Attribute name" valueLabel="Attribute value" addLabel="Add attribute" emptyText="No message attributes." max={10} />
      </Panel>
    </FormPage>
  );
}
