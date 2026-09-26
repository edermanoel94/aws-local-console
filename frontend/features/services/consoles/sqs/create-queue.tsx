"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { Checkbox, KeyValueEditor, RadioCards, fromKeyValues, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { optionalInt } from "../_shared/validation";

const schema = z
  .object({
    type: z.enum(["standard", "fifo"]),
    name: z.string().trim().min(1, "Enter a queue name."),
    visibilityTimeout: optionalInt(0, 43200, "Visibility timeout"),
    retentionPeriod: optionalInt(60, 1209600, "Message retention period"),
    delaySeconds: optionalInt(0, 900, "Delivery delay"),
    maximumMessageSize: optionalInt(1024, 262144, "Maximum message size"),
    receiveWaitTime: optionalInt(0, 20, "Receive message wait time"),
    contentBasedDeduplication: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const base = v.type === "fifo" ? v.name.replace(/\.fifo$/, "") : v.name;
    if (!/^[A-Za-z0-9_-]+$/.test(base)) ctx.addIssue({ code: "custom", path: ["name"], message: "Queue names can contain only alphanumeric characters, hyphens (-) and underscores (_)." });
    const full = v.type === "fifo" ? `${base}.fifo` : v.name;
    if (full.length > 80) ctx.addIssue({ code: "custom", path: ["name"], message: "Queue names can be up to 80 characters long." });
  });

type FormValues = z.infer<typeof schema>;

export function CreateQueuePage() {
  const { navigate } = useConsoleNav();
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "standard",
      name: "",
      visibilityTimeout: "30",
      retentionPeriod: "345600",
      delaySeconds: "0",
      maximumMessageSize: "262144",
      receiveWaitTime: "0",
      contentBasedDeduplication: false,
    },
  });
  const type = useWatch({ control: form.control, name: "type" });

  const create = useConsoleAction<FormValues & { queueName: string }>({
    run: (v, exec) => {
      const attributes: Record<string, string> = {};
      const set = (key: string, value: string) => {
        if (value.trim() !== "") attributes[key] = value.trim();
      };
      set("VisibilityTimeout", v.visibilityTimeout);
      set("MessageRetentionPeriod", v.retentionPeriod);
      set("DelaySeconds", v.delaySeconds);
      set("MaximumMessageSize", v.maximumMessageSize);
      set("ReceiveMessageWaitTimeSeconds", v.receiveWaitTime);
      if (v.type === "fifo") {
        attributes.FifoQueue = "true";
        if (v.contentBasedDeduplication) attributes.ContentBasedDeduplication = "true";
      }
      const tagMap = fromKeyValues(tags);
      return exec("sqs", "CreateQueue", { QueueName: v.queueName, Attributes: attributes, ...(Object.keys(tagMap).length ? { Tags: tagMap } : {}) });
    },
    successMessage: (v) => `Queue ${v.queueName} created`,
    onSuccess: (_, v) => navigate({ resource: v.queueName }),
  });

  const { errors } = form.formState;

  return (
    <FormPage
      crumbs={[{ label: "Queues", to: {} }, { label: "Create queue" }]}
      title="Create queue"
      onSubmit={form.handleSubmit((v) => {
        const queueName = v.type === "fifo" && !v.name.endsWith(".fifo") ? `${v.name}.fifo` : v.name;
        create.mutate({ ...v, queueName });
      })}
      onCancel={() => navigate({})}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="Details">
        <div className="flex flex-col gap-4">
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <RadioCards
                legend="Type"
                name="queue-type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "standard", label: "Standard", description: "At-least-once delivery, message ordering isn't preserved." },
                  { value: "fifo", label: "FIFO", description: "First-in-first-out delivery, message ordering is preserved." },
                ]}
              />
            )}
          />
          <TextField
            label="Queue name"
            placeholder={type === "fifo" ? "orders.fifo" : "orders"}
            autoFocus
            description={type === "fifo" ? 'FIFO queue names end with ".fifo" (added automatically).' : "A queue name is case-sensitive and can have up to 80 characters."}
            error={errors.name?.message}
            {...form.register("name")}
          />
        </div>
      </Panel>
      <Panel title="Configuration" description="Set the maximum message size, visibility to other consumers, and message retention.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Visibility timeout (seconds)" inputMode="numeric" description="0 seconds to 12 hours" error={errors.visibilityTimeout?.message} {...form.register("visibilityTimeout")} />
          <TextField label="Message retention period (seconds)" inputMode="numeric" description="1 minute to 14 days" error={errors.retentionPeriod?.message} {...form.register("retentionPeriod")} />
          <TextField label="Delivery delay (seconds)" inputMode="numeric" description="0 seconds to 15 minutes" error={errors.delaySeconds?.message} {...form.register("delaySeconds")} />
          <TextField label="Maximum message size (bytes)" inputMode="numeric" description="1 KB to 256 KB" error={errors.maximumMessageSize?.message} {...form.register("maximumMessageSize")} />
          <TextField label="Receive message wait time (seconds)" inputMode="numeric" description="0 to 20 seconds (long polling)" error={errors.receiveWaitTime?.message} {...form.register("receiveWaitTime")} />
        </div>
        {type === "fifo" && (
          <Checkbox
            className="mt-4"
            label="Content-based deduplication"
            description="Use a SHA-256 hash of the message body to generate the deduplication ID."
            {...form.register("contentBasedDeduplication")}
          />
        )}
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with this queue." />
      </Panel>
    </FormPage>
  );
}
