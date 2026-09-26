"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { Button, ErrorAlert, Panel, SelectField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { CodeField } from "../_shared/controls";
import { ConsoleHeader } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { jsonText } from "../_shared/validation";
import { DEFAULT_BUS } from "./events-types";
import { useEventBuses } from "./rule-list";

const schema = z.object({
  bus: z.string().min(1),
  source: z.string().trim().min(1, "Enter an event source.").max(256),
  detailType: z.string().trim().min(1, "Enter a detail type.").max(128),
  detail: jsonText("Event detail", { object: true }),
});

type FormValues = z.infer<typeof schema>;

interface PutEventsOutput {
  FailedEntryCount?: number;
  Entries?: { EventId?: string | null; ErrorCode?: string | null; ErrorMessage?: string | null }[] | null;
}

/** PutEvents form; stays on the page so several events can be sent in a row. */
export function SendEventsPage() {
  const { prefix, navigate } = useConsoleNav();
  const buses = useEventBuses();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { bus: prefix ?? DEFAULT_BUS, source: "my.application", detailType: "Order Placed", detail: '{\n  "orderId": "1234",\n  "amount": 42\n}' },
  });

  const send = useConsoleAction<FormValues, PutEventsOutput>({
    run: async (v, exec) => {
      const out = await exec<PutEventsOutput>("events", "PutEvents", {
        Entries: [{ EventBusName: v.bus, Source: v.source, DetailType: v.detailType, Detail: JSON.stringify(JSON.parse(v.detail)) }],
      });
      const failed = out.Entries?.find((e) => e.ErrorCode);
      if (out.FailedEntryCount || failed) throw new Error(`${failed?.ErrorCode ?? "PutEventsFailed"}: ${failed?.ErrorMessage ?? "The event was not accepted."}`);
      return out;
    },
    successMessage: (v, out) => `Event sent to ${v.bus}${out.Entries?.[0]?.EventId ? ` (ID ${out.Entries[0].EventId})` : ""}`,
  });

  const busOptions = (buses.data?.EventBuses ?? [{ Name: DEFAULT_BUS }]).map((b) => ({ value: b.Name, label: b.Name }));
  const { errors } = form.formState;
  const back = () => navigate({ prefix: prefix ?? null });
  const eventId = send.data?.Entries?.[0]?.EventId;

  return (
    <form onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate className="flex max-w-4xl flex-col gap-4">
      <ConsoleHeader
        crumbs={[{ label: "Rules", to: { prefix: prefix ?? null } }, { label: "Send events" }]}
        title="Send events"
        description="Put a custom event on an event bus (PutEvents). Rules matching the event forward it to their targets."
      />
      <Panel title="Event entry">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField label="Event bus" options={busOptions} {...form.register("bus")} />
            <TextField label="Event source" placeholder="my.application" error={errors.source?.message} {...form.register("source")} />
            <TextField label="Detail type" placeholder="Order Placed" error={errors.detailType?.message} {...form.register("detailType")} />
          </div>
          <Controller
            control={form.control}
            name="detail"
            render={({ field }) => <CodeField label="Event detail" value={field.value} onChange={field.onChange} rows={10} error={errors.detail?.message} />}
          />
        </div>
      </Panel>
      {send.error && <ErrorAlert error={send.error} />}
      {eventId && !send.isPending && (
        <p className="flex items-center gap-2 rounded-lg border border-aws-green bg-green-50 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 text-aws-green" aria-hidden />
          Last event accepted with ID <span className="font-mono text-xs">{eventId}</span>
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={back}>Cancel</Button>
        <Button type="submit" variant="primary" loading={send.isPending}>
          Send
        </Button>
      </div>
    </form>
  );
}
