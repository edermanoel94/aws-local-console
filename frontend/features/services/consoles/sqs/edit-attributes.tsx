"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, ErrorAlert, Panel, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { SuggestField } from "../_shared/controls";
import { useQueueOptions } from "../_shared/pickers";
import { optionalInt, requiredInt } from "../_shared/validation";
import type { QueueInfo } from "./sqs-utils";

const schema = z
  .object({
    visibilityTimeout: requiredInt(0, 43200, "Visibility timeout"),
    retentionPeriod: requiredInt(60, 1209600, "Message retention period"),
    delaySeconds: requiredInt(0, 900, "Delivery delay"),
    maximumMessageSize: requiredInt(1024, 262144, "Maximum message size"),
    receiveWaitTime: requiredInt(0, 20, "Receive message wait time"),
    deadLetterTargetArn: z.string().trim(),
    maxReceiveCount: optionalInt(1, 1000, "Maximum receives"),
  })
  .refine((v) => !v.deadLetterTargetArn || v.maxReceiveCount !== "", { path: ["maxReceiveCount"], message: "Enter the maximum receives for the dead-letter queue." });

type FormValues = z.infer<typeof schema>;

function parseRedrive(value: string | undefined): { deadLetterTargetArn: string; maxReceiveCount: string } {
  try {
    const p = JSON.parse(value ?? "");
    return { deadLetterTargetArn: p.deadLetterTargetArn ?? "", maxReceiveCount: p.maxReceiveCount ? String(p.maxReceiveCount) : "" };
  } catch {
    return { deadLetterTargetArn: "", maxReceiveCount: "" };
  }
}

/** Editable queue configuration (SetQueueAttributes). */
export function EditQueueAttributes({ queueName, queue }: { queueName: string; queue: QueueInfo }) {
  const a = queue.attributes;
  const queues = useQueueOptions();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      visibilityTimeout: a.VisibilityTimeout ?? "30",
      retentionPeriod: a.MessageRetentionPeriod ?? "345600",
      delaySeconds: a.DelaySeconds ?? "0",
      maximumMessageSize: a.MaximumMessageSize ?? "262144",
      receiveWaitTime: a.ReceiveMessageWaitTimeSeconds ?? "0",
      ...parseRedrive(a.RedrivePolicy),
    },
  });

  const save = useConsoleAction<FormValues>({
    run: (v, exec) => {
      const attributes: Record<string, string> = {
        VisibilityTimeout: v.visibilityTimeout,
        MessageRetentionPeriod: v.retentionPeriod,
        DelaySeconds: v.delaySeconds,
        MaximumMessageSize: v.maximumMessageSize,
        ReceiveMessageWaitTimeSeconds: v.receiveWaitTime,
      };
      if (v.deadLetterTargetArn) attributes.RedrivePolicy = JSON.stringify({ deadLetterTargetArn: v.deadLetterTargetArn, maxReceiveCount: Number(v.maxReceiveCount) });
      else if (a.RedrivePolicy) attributes.RedrivePolicy = "";
      return exec("sqs", "SetQueueAttributes", { QueueUrl: queue.url, Attributes: attributes });
    },
    successMessage: () => `Queue ${queueName} updated`,
    onSuccess: (_, v) => form.reset(v),
  });

  const { errors, isDirty } = form.formState;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="flex flex-col gap-4">
      <Panel title="Configuration" description="Changes apply to messages already in the queue where applicable.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Visibility timeout (seconds)" inputMode="numeric" error={errors.visibilityTimeout?.message} {...form.register("visibilityTimeout")} />
          <TextField label="Message retention period (seconds)" inputMode="numeric" error={errors.retentionPeriod?.message} {...form.register("retentionPeriod")} />
          <TextField label="Delivery delay (seconds)" inputMode="numeric" error={errors.delaySeconds?.message} {...form.register("delaySeconds")} />
          <TextField label="Maximum message size (bytes)" inputMode="numeric" error={errors.maximumMessageSize?.message} {...form.register("maximumMessageSize")} />
          <TextField label="Receive message wait time (seconds)" inputMode="numeric" error={errors.receiveWaitTime?.message} {...form.register("receiveWaitTime")} />
        </div>
      </Panel>
      <Panel title="Dead-letter queue" description="Send messages that can't be processed after the maximum receives to another queue.">
        <div className="grid gap-4 md:grid-cols-2">
          <SuggestField
            label="Dead-letter queue ARN"
            placeholder="arn:aws:sqs:us-east-1:000000000000:my-dlq"
            suggestions={(queues.data ?? []).filter((q) => q.label !== queueName)}
            {...form.register("deadLetterTargetArn")}
          />
          <TextField label="Maximum receives" inputMode="numeric" placeholder="3" error={errors.maxReceiveCount?.message} {...form.register("maxReceiveCount")} />
        </div>
      </Panel>
      {save.error && <ErrorAlert error={save.error} />}
      <div className="flex justify-end gap-2">
        <Button onClick={() => form.reset()} disabled={!isDirty}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
