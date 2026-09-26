"use client";

import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Button, EmptyState, ErrorAlert, Panel, Table, Td, TextAreaField, TextField, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useConsoleAction } from "../_shared/aws";
import { KeyValueEditor, type KeyValue } from "../_shared/controls";
import { formatBytes, formatDateTime, prettyJson } from "../_shared/format";
import { requiredInt, optionalInt } from "../_shared/validation";
import { isFifo } from "./sqs-utils";

interface SqsMessage {
  MessageId: string;
  ReceiptHandle: string;
  Body: string;
  MD5OfBody?: string;
  Attributes?: Record<string, string> | null;
  MessageAttributes?: Record<string, { DataType: string; StringValue?: string }> | null;
}

export function SendReceive({ queueName, queueUrl }: { queueName: string; queueUrl: string }) {
  return (
    <div className="flex flex-col gap-4">
      <SendMessagePanel queueName={queueName} queueUrl={queueUrl} />
      <ReceiveMessagesPanel queueUrl={queueUrl} />
    </div>
  );
}

const sendSchema = (fifo: boolean) =>
  z
    .object({
      body: z.string().min(1, "Enter a message body."),
      groupId: z.string().trim(),
      deduplicationId: z.string().trim(),
      delaySeconds: optionalInt(0, 900, "Delivery delay"),
    })
    .refine((v) => !fifo || v.groupId !== "", { path: ["groupId"], message: "Message group ID is required for FIFO queues." });

type SendValues = z.infer<ReturnType<typeof sendSchema>>;

function SendMessagePanel({ queueName, queueUrl }: { queueName: string; queueUrl: string }) {
  const fifo = isFifo(queueName);
  const [attributes, setAttributes] = useState<KeyValue[]>([]);
  const form = useForm<SendValues>({ resolver: zodResolver(sendSchema(fifo)), defaultValues: { body: "", groupId: "", deduplicationId: "", delaySeconds: "" } });

  const send = useConsoleAction<SendValues, { MessageId?: string }>({
    run: (v, exec) => {
      const messageAttributes = Object.fromEntries(attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim(), { DataType: "String", StringValue: a.value }]));
      return exec("sqs", "SendMessage", {
        QueueUrl: queueUrl,
        MessageBody: v.body,
        ...(fifo ? { MessageGroupId: v.groupId } : {}),
        ...(fifo && v.deduplicationId ? { MessageDeduplicationId: v.deduplicationId } : {}),
        ...(!fifo && v.delaySeconds ? { DelaySeconds: Number(v.delaySeconds) } : {}),
        ...(Object.keys(messageAttributes).length ? { MessageAttributes: messageAttributes } : {}),
      });
    },
    successMessage: (_, out) => `Message sent to ${queueName}${out.MessageId ? ` (ID ${out.MessageId})` : ""}`,
    onSuccess: () => form.reset({ ...form.getValues(), body: "", deduplicationId: "" }),
  });

  const { errors } = form.formState;
  return (
    <Panel title="Send message" description={`Messages are sent to ${queueName}.`}>
      <form onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate className="flex flex-col gap-4">
        <TextAreaField label="Message body" rows={6} placeholder='{"orderId": "1234"}' error={errors.body?.message} {...form.register("body")} />
        <div className="grid gap-4 md:grid-cols-2">
          {fifo ? (
            <>
              <TextField label="Message group ID" placeholder="group-1" error={errors.groupId?.message} {...form.register("groupId")} />
              <TextField label="Message deduplication ID" placeholder="Optional with content-based deduplication" {...form.register("deduplicationId")} />
            </>
          ) : (
            <TextField label="Delivery delay (seconds)" inputMode="numeric" placeholder="0" error={errors.delaySeconds?.message} {...form.register("delaySeconds")} />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold">Message attributes - optional</p>
          <KeyValueEditor rows={attributes} onChange={setAttributes} keyLabel="Attribute name" valueLabel="Attribute value" addLabel="Add attribute" emptyText="No message attributes." max={10} />
        </div>
        {send.error && <ErrorAlert error={send.error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={() => form.reset({ ...form.getValues(), body: "" })}>Clear content</Button>
          <Button type="submit" variant="primary" loading={send.isPending}>
            Send message
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const receiveSchema = z.object({
  waitTime: requiredInt(0, 20, "Poll duration"),
  maxMessages: requiredInt(1, 10, "Maximum message count"),
});

type ReceiveValues = z.infer<typeof receiveSchema>;

function ReceiveMessagesPanel({ queueUrl }: { queueUrl: string }) {
  const [messages, setMessages] = useState<SqsMessage[]>([]);
  const [polled, setPolled] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const form = useForm<ReceiveValues>({ resolver: zodResolver(receiveSchema), defaultValues: { waitTime: "1", maxMessages: "10" } });

  const receive = useConsoleAction<ReceiveValues, { Messages?: SqsMessage[] | null }>({
    run: (v, exec) =>
      exec("sqs", "ReceiveMessage", {
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Number(v.maxMessages),
        WaitTimeSeconds: Number(v.waitTime),
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    onSuccess: (out) => {
      setPolled(true);
      const received = out.Messages ?? [];
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.MessageId, m]));
        for (const m of received) byId.set(m.MessageId, m);
        return [...byId.values()];
      });
    },
  });

  const remove = useConsoleAction<SqsMessage>({
    run: (m, exec) => exec("sqs", "DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }),
    successMessage: (m) => `Message ${m.MessageId} deleted`,
    onSuccess: (_, m) => setMessages((prev) => prev.filter((x) => x.MessageId !== m.MessageId)),
  });

  const { errors } = form.formState;
  return (
    <Panel
      title="Receive messages"
      count={polled ? messages.length : undefined}
      description="Received messages stay invisible to other consumers for the queue's visibility timeout. Delete them once processed."
      bodyClassName="px-0! py-0!"
    >
      <form onSubmit={form.handleSubmit((v) => receive.mutate(v))} noValidate className="flex flex-wrap items-end gap-3 px-5 py-4">
        <TextField label="Poll duration (seconds)" inputMode="numeric" className="w-44" error={errors.waitTime?.message} {...form.register("waitTime")} />
        <TextField label="Maximum message count" inputMode="numeric" className="w-44" error={errors.maxMessages?.message} {...form.register("maxMessages")} />
        <div className="flex gap-2 pb-px">
          <Button type="submit" variant="primary" loading={receive.isPending}>
            Receive messages
          </Button>
          <Button
            onClick={() => {
              setMessages([]);
              setPolled(false);
            }}
            disabled={!messages.length}
          >
            Clear list
          </Button>
        </div>
      </form>
      {(receive.error || remove.error) && (
        <div className="px-5 pb-4">
          <ErrorAlert error={receive.error ?? remove.error} />
        </div>
      )}
      {messages.length === 0 ? (
        <div className="border-t border-aws-border">
          <EmptyState
            title={polled ? "No messages received" : "No messages polled yet"}
            description={polled ? "The queue returned no visible messages. Send a message or poll again." : "Choose Receive messages to poll the queue."}
          />
        </div>
      ) : (
        <Table aria-label="Received messages" className="border-t border-aws-border [&_tbody_tr:last-child_td]:border-b-0">
          <thead>
            <tr>
              <Th className="pl-5">ID</Th>
              <Th>Body</Th>
              <Th>Sent</Th>
              <Th>Size</Th>
              <Th>Receive count</Th>
              <Th className="pr-5">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => {
              const open = expanded === m.MessageId;
              return (
                <Fragment key={m.MessageId}>
                  <Tr>
                    <Td className="pl-5">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : m.MessageId)}
                        className="flex items-center gap-1 text-left font-mono text-xs font-bold text-aws-link hover:underline"
                      >
                        {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
                        {m.MessageId}
                      </button>
                    </Td>
                    <Td className="max-w-md">
                      <span className="line-clamp-2 font-mono text-xs break-all">{m.Body}</span>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(m.Attributes?.SentTimestamp)}</Td>
                    <Td className="whitespace-nowrap">{formatBytes(new TextEncoder().encode(m.Body).length)}</Td>
                    <Td>{m.Attributes?.ApproximateReceiveCount ?? "-"}</Td>
                    <Td className="pr-5 text-right">
                      <Button size="sm" aria-label="Delete message" title="Delete message" onClick={() => remove.mutate(m)} loading={remove.isPending && remove.variables?.MessageId === m.MessageId}>
                        <Trash2 className="size-3.5" aria-hidden />
                        Delete
                      </Button>
                    </Td>
                  </Tr>
                  {open && (
                    <tr>
                      <td colSpan={6} className={cn("border-b border-aws-border bg-aws-panel/60 px-5 py-4")}>
                        <MessageDetails message={m} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function MessageDetails({ message }: { message: SqsMessage }) {
  const attrs = Object.entries(message.Attributes ?? {});
  const messageAttrs = Object.entries(message.MessageAttributes ?? {});
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="min-w-0">
        <p className="mb-1 text-sm font-bold">Body</p>
        <pre aria-label="Message body content" className="max-h-80 overflow-auto rounded-lg border border-aws-border bg-white p-3 font-mono text-xs whitespace-pre-wrap">
          {prettyJson(message.Body)}
        </pre>
      </div>
      <div className="flex min-w-0 flex-col gap-3 text-xs">
        <div>
          <p className="mb-1 text-sm font-bold">Attributes</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-aws-muted">MD5 of body</dt>
            <dd className="font-mono break-all">{message.MD5OfBody ?? "-"}</dd>
            {attrs.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-aws-muted">{k}</dt>
                <dd className="font-mono break-all">{/Timestamp$/.test(k) ? formatDateTime(v) : v}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
        {messageAttrs.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-bold">Message attributes</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {messageAttrs.map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-aws-muted">
                    {k} <span className="text-aws-muted">({v.DataType})</span>
                  </dt>
                  <dd className="font-mono break-all">{v.StringValue ?? "-"}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
