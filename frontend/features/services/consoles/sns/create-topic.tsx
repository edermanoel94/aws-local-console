"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { Checkbox, KeyValueEditor, RadioCards, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";

const schema = z
  .object({
    type: z.enum(["standard", "fifo"]),
    name: z.string().trim().min(1, "Enter a topic name."),
    displayName: z.string().trim().max(100, "Display names can be up to 100 characters."),
    contentBasedDeduplication: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const base = v.type === "fifo" ? v.name.replace(/\.fifo$/, "") : v.name;
    if (!/^[A-Za-z0-9_-]+$/.test(base)) ctx.addIssue({ code: "custom", path: ["name"], message: "Topic names can contain only alphanumeric characters, hyphens (-) and underscores (_)." });
    if (base.length > 256) ctx.addIssue({ code: "custom", path: ["name"], message: "Topic names can be up to 256 characters long." });
  });

type FormValues = z.infer<typeof schema>;

export function CreateTopicPage() {
  const { navigate } = useConsoleNav();
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { type: "standard", name: "", displayName: "", contentBasedDeduplication: false } });
  const type = useWatch({ control: form.control, name: "type" });

  const create = useConsoleAction<FormValues & { topicName: string }>({
    run: (v, exec) => {
      const attributes: Record<string, string> = {};
      if (v.displayName) attributes.DisplayName = v.displayName;
      if (v.type === "fifo") {
        attributes.FifoTopic = "true";
        if (v.contentBasedDeduplication) attributes.ContentBasedDeduplication = "true";
      }
      const tagList = tags.filter((t) => t.key.trim()).map((t) => ({ Key: t.key.trim(), Value: t.value }));
      return exec("sns", "CreateTopic", { Name: v.topicName, Attributes: attributes, ...(tagList.length ? { Tags: tagList } : {}) });
    },
    successMessage: (v) => `Topic ${v.topicName} created`,
    onSuccess: (_, v) => navigate({ resource: v.topicName }),
  });

  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "Topics", to: {} }, { label: "Create topic" }]}
      title="Create topic"
      onSubmit={form.handleSubmit((v) => create.mutate({ ...v, topicName: v.type === "fifo" && !v.name.endsWith(".fifo") ? `${v.name}.fifo` : v.name }))}
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
                name="topic-type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "standard", label: "Standard", description: "Best-effort ordering, at-least-once delivery. Supports SQS, Lambda, HTTP, email and SMS." },
                  { value: "fifo", label: "FIFO", description: "Strictly-preserved ordering and exactly-once delivery to SQS queues." },
                ]}
              />
            )}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Topic name"
              placeholder={type === "fifo" ? "orders.fifo" : "orders"}
              autoFocus
              description={type === "fifo" ? 'FIFO topic names end with ".fifo" (added automatically).' : "Up to 256 alphanumeric characters, hyphens and underscores."}
              error={errors.name?.message}
              {...form.register("name")}
            />
            <TextField label="Display name - optional" placeholder="My Topic" error={errors.displayName?.message} {...form.register("displayName")} />
          </div>
          {type === "fifo" && <Checkbox label="Content-based message deduplication" description="Use a SHA-256 hash of the message body as the deduplication ID." {...form.register("contentBasedDeduplication")} />}
        </div>
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with this topic." />
      </Panel>
    </FormPage>
  );
}
