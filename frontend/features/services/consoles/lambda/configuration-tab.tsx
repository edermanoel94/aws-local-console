"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, ErrorAlert, Panel, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { KeyValueEditor, fromKeyValues, toKeyValues, type KeyValue } from "../_shared/controls";
import { requiredInt } from "../_shared/validation";
import { validateEnvironment } from "./create-function";
import type { FunctionConfiguration } from "./lambda-types";

const schema = z.object({
  description: z.string().max(256, "Descriptions can be up to 256 characters."),
  handler: z
    .string()
    .trim()
    .min(1, "Enter a handler.")
    .regex(/^[^\s]+\.[^\s.]+$/, 'Handlers look like "file.function", e.g. index.handler.'),
  memory: requiredInt(128, 10240, "Memory"),
  timeout: requiredInt(1, 900, "Timeout"),
});

type FormValues = z.infer<typeof schema>;

/** General configuration + environment variables, saved together with UpdateFunctionConfiguration. */
export function ConfigurationTab({ fn }: { fn: FunctionConfiguration }) {
  const initialEnv = toKeyValues(fn.Environment?.Variables ?? undefined);
  const [env, setEnv] = useState<KeyValue[]>(initialEnv);
  const [envError, setEnvError] = useState<string>();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { description: fn.Description ?? "", handler: fn.Handler ?? "", memory: String(fn.MemorySize ?? 128), timeout: String(fn.Timeout ?? 3) },
  });

  const save = useConsoleAction<FormValues>({
    run: (v, exec) =>
      exec("lambda", "UpdateFunctionConfiguration", {
        FunctionName: fn.FunctionName,
        Description: v.description,
        Handler: v.handler,
        MemorySize: Number(v.memory),
        Timeout: Number(v.timeout),
        Environment: { Variables: fromKeyValues(env) },
      }),
    successMessage: () => `Function ${fn.FunctionName} configuration saved`,
  });

  const { errors } = form.formState;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((v) => {
        const invalid = validateEnvironment(env);
        setEnvError(invalid);
        if (!invalid) save.mutate(v);
      })}
    >
      <Panel title="General configuration">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Description" error={errors.description?.message} {...form.register("description")} />
          <TextField label="Handler" error={errors.handler?.message} {...form.register("handler")} />
          <TextField label="Memory (MB)" inputMode="numeric" error={errors.memory?.message} {...form.register("memory")} />
          <TextField label="Timeout (seconds)" inputMode="numeric" error={errors.timeout?.message} {...form.register("timeout")} />
        </div>
      </Panel>
      <Panel title="Environment variables" count={env.filter((r) => r.key.trim()).length} description="Key-value pairs available to the function code through the process environment.">
        <div className="flex flex-col gap-2">
          <KeyValueEditor rows={env} onChange={setEnv} keyLabel="Key" valueLabel="Value" addLabel="Add environment variable" emptyText="No environment variables." />
          {envError && <p className="text-xs text-aws-red">{envError}</p>}
        </div>
      </Panel>
      {save.error && <ErrorAlert error={save.error} />}
      <div className="flex justify-end gap-2">
        <Button
          onClick={() => {
            form.reset();
            setEnv(initialEnv);
            setEnvError(undefined);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
