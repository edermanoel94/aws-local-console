"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, SelectField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { CodeField, RadioCards } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { DEFAULT_BUS, PATTERN_TEMPLATES, type TargetType } from "./events-types";
import { useEventBuses } from "./rule-list";
import { addTarget, TargetFields } from "./targets";

const DEFAULT_PATTERN = JSON.stringify(PATTERN_TEMPLATES[1].pattern, null, 2);

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a rule name.")
      .max(64, "Rule names can be up to 64 characters.")
      .regex(/^[A-Za-z0-9._-]+$/, "Rule names can contain only letters, numbers, periods (.), hyphens (-) and underscores (_)."),
    description: z.string().max(512),
    bus: z.string().min(1),
    kind: z.enum(["pattern", "schedule"]),
    pattern: z.string(),
    schedule: z.string().trim(),
    targetType: z.enum(["sqs", "lambda", "sns"]),
    targetArn: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "pattern") {
      try {
        const parsed = JSON.parse(v.pattern);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length === 0) throw new Error();
      } catch {
        ctx.addIssue({ code: "custom", path: ["pattern"], message: "The event pattern must be a non-empty JSON object." });
      }
    } else if (!/^(rate|cron)\(.+\)$/.test(v.schedule)) {
      ctx.addIssue({ code: "custom", path: ["schedule"], message: "Use rate(5 minutes) or cron(0 12 * * ? *)." });
    }
  });

type FormValues = z.infer<typeof schema>;

export function CreateRulePage() {
  const { prefix, navigate } = useConsoleNav();
  const buses = useEventBuses();
  const [template, setTemplate] = useState("");
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", bus: prefix ?? DEFAULT_BUS, kind: "pattern", pattern: DEFAULT_PATTERN, schedule: "rate(5 minutes)", targetType: "sqs", targetArn: "" },
  });
  const [kind, bus, targetType, targetArn] = useWatch({ control: form.control, name: ["kind", "bus", "targetType", "targetArn"] });
  const back = () => navigate({ prefix: bus === DEFAULT_BUS ? null : bus });

  const create = useConsoleAction<FormValues>({
    run: async (v, exec) => {
      const { RuleArn } = await exec<{ RuleArn?: string }>("events", "PutRule", {
        Name: v.name,
        EventBusName: v.bus,
        State: "ENABLED",
        ...(v.description ? { Description: v.description } : {}),
        ...(v.kind === "pattern" ? { EventPattern: JSON.stringify(JSON.parse(v.pattern)) } : { ScheduleExpression: v.schedule }),
      });
      if (v.targetArn) await addTarget(exec, { name: v.name, bus: v.bus, arn: RuleArn }, v.targetArn, []);
    },
    successMessage: (v) => `Rule ${v.name} created`,
    onSuccess: (_, v) => navigate({ resource: v.name, prefix: v.bus === DEFAULT_BUS ? null : v.bus }),
  });

  const { errors } = form.formState;
  const busOptions = (buses.data?.EventBuses ?? [{ Name: DEFAULT_BUS }]).map((b) => ({ value: b.Name, label: b.Name }));
  if (!busOptions.some((b) => b.value === bus)) busOptions.unshift({ value: bus, label: bus });

  return (
    <FormPage
      crumbs={[{ label: "Rules", to: { prefix: bus === DEFAULT_BUS ? null : bus } }, { label: "Create rule" }]}
      title="Create rule"
      description="A rule watches for events that match its pattern (or runs on a schedule) and sends them to targets."
      onSubmit={form.handleSubmit((v) => create.mutate(v))}
      onCancel={back}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="Rule detail">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Rule name" placeholder="order-events" autoFocus error={errors.name?.message} {...form.register("name")} />
            <SelectField label="Event bus" options={busOptions} {...form.register("bus")} />
            <TextField label="Description - optional" className="md:col-span-2" error={errors.description?.message} {...form.register("description")} />
          </div>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <RadioCards
                legend="Rule type"
                name="rule-type"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "pattern", label: "Rule with an event pattern", description: "Matches events on the bus." },
                  { value: "schedule", label: "Schedule", description: "Runs on a rate or cron expression." },
                ]}
              />
            )}
          />
        </div>
      </Panel>
      {kind === "pattern" ? (
        <Panel title="Event pattern" description="Only events that match the pattern are sent to the targets.">
          <div className="flex flex-col gap-4">
            <SelectField
              label="Pattern template"
              value={template}
              options={[{ value: "", label: "Custom pattern" }, ...PATTERN_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))]}
              onChange={(e) => {
                setTemplate(e.target.value);
                const t = PATTERN_TEMPLATES.find((p) => p.value === e.target.value);
                if (t) form.setValue("pattern", JSON.stringify(t.pattern, null, 2), { shouldValidate: true });
              }}
            />
            <Controller
              control={form.control}
              name="pattern"
              render={({ field }) => <CodeField label="Event pattern" value={field.value} onChange={field.onChange} rows={12} error={errors.pattern?.message} />}
            />
          </div>
        </Panel>
      ) : (
        <Panel title="Schedule">
          <TextField label="Schedule expression" placeholder="rate(5 minutes)" error={errors.schedule?.message} {...form.register("schedule")} />
        </Panel>
      )}
      <Panel title="Target - optional" description="Send matching events to a queue, function or topic. More targets can be added later.">
        <TargetFields
          type={targetType as TargetType}
          arn={targetArn}
          onTypeChange={(t) => form.setValue("targetType", t)}
          onArnChange={(arn) => form.setValue("targetArn", arn, { shouldDirty: true })}
          optional
        />
      </Panel>
    </FormPage>
  );
}
