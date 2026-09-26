"use client";

import { useState, type ChangeEvent } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, SelectField, TextField } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { useConsoleAction } from "../_shared/aws";
import { CodeField, KeyValueEditor, fromKeyValues, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { requiredInt } from "../_shared/validation";
import type { FunctionConfiguration } from "./lambda-types";
import { codeFileName, defaultCode, defaultHandler, DEFAULT_ROLE, ENV_KEY_PATTERN, rememberCode, RUNTIMES } from "./runtimes";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a function name.")
    .max(64, "Function names can be up to 64 characters.")
    .regex(/^[a-zA-Z0-9-_]+$/, "Function names can contain only letters, numbers, hyphens (-) and underscores (_)."),
  runtime: z.string(),
  handler: z
    .string()
    .trim()
    .min(1, "Enter a handler.")
    .regex(/^[^\s]+\.[^\s.]+$/, 'Handlers look like "file.function", e.g. index.handler.'),
  code: z.string().min(1, "Enter the function code."),
  role: z.string().trim().regex(/^arn:aws:iam::\d{12}:role\/.+$/, "Enter an IAM role ARN."),
  description: z.string().max(256, "Descriptions can be up to 256 characters."),
  memory: requiredInt(128, 10240, "Memory"),
  timeout: requiredInt(1, 900, "Timeout"),
});

type FormValues = z.infer<typeof schema>;

export function validateEnvironment(rows: KeyValue[]): string | undefined {
  const keys = rows.map((r) => r.key.trim()).filter(Boolean);
  const bad = keys.find((k) => !ENV_KEY_PATTERN.test(k));
  if (bad) return `"${bad}" is not a valid environment variable name. Use letters, numbers and underscores, starting with a letter.`;
  if (new Set(keys).size !== keys.length) return "Environment variable names must be unique.";
  if (rows.some((r) => !r.key.trim() && r.value)) return "Every environment variable needs a key.";
  return undefined;
}

export function CreateFunctionPage() {
  const { navigate } = useConsoleNav();
  const region = useRegion();
  const [env, setEnv] = useState<KeyValue[]>([]);
  const [envError, setEnvError] = useState<string>();
  const initialRuntime = RUNTIMES[0].value;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      runtime: initialRuntime,
      handler: defaultHandler(initialRuntime),
      code: defaultCode(initialRuntime),
      role: DEFAULT_ROLE,
      description: "",
      memory: "128",
      timeout: "3",
    },
  });
  const [runtime, handler] = useWatch({ control: form.control, name: ["runtime", "handler"] });

  const create = useConsoleAction<FormValues, FunctionConfiguration>({
    run: (v, exec) => {
      const variables = fromKeyValues(env);
      return exec<FunctionConfiguration>("lambda", "CreateFunction", {
        FunctionName: v.name,
        Runtime: v.runtime,
        Handler: v.handler,
        Role: v.role,
        Code: { ZipFile: { zipFiles: { [codeFileName(v.handler, v.runtime)]: v.code } } },
        MemorySize: Number(v.memory),
        Timeout: Number(v.timeout),
        ...(v.description ? { Description: v.description } : {}),
        ...(Object.keys(variables).length ? { Environment: { Variables: variables } } : {}),
      });
    },
    successMessage: (v) => `Function ${v.name} created`,
    onSuccess: (out, v) => {
      if (out.CodeSha256) rememberCode(region, v.name, { sha: out.CodeSha256, fileName: codeFileName(v.handler, v.runtime), code: v.code });
      navigate({ resource: v.name });
    },
  });

  // Swaps the handler and code templates when they were not edited. It runs before react-hook-form stores the new
  // runtime (the register onChange option would run after it, when the previous runtime is already gone).
  const runtimeField = form.register("runtime");
  const onRuntimeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const previous = form.getValues("runtime");
    const next = event.target.value;
    if (form.getValues("handler") === defaultHandler(previous)) form.setValue("handler", defaultHandler(next));
    if (form.getValues("code") === defaultCode(previous)) form.setValue("code", defaultCode(next));
    return runtimeField.onChange(event);
  };

  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "Functions", to: {} }, { label: "Create function" }]}
      title="Create function"
      description="Author a function from scratch with inline code. The code is packaged as a .zip archive and deployed to Floci."
      onSubmit={form.handleSubmit((v) => {
        const invalid = validateEnvironment(env);
        setEnvError(invalid);
        if (!invalid) create.mutate(v);
      })}
      onCancel={() => navigate({})}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="Basic information">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Function name"
            placeholder="myFunctionName"
            autoFocus
            description="Up to 64 letters, numbers, hyphens and underscores."
            error={errors.name?.message}
            {...form.register("name")}
          />
          <SelectField
            label="Runtime"
            description="The language used to write your function."
            options={RUNTIMES.map((r) => ({ value: r.value, label: r.label }))}
            {...runtimeField}
            onChange={onRuntimeChange}
          />
          <TextField label="Handler" description="file.function that Lambda calls to start execution." error={errors.handler?.message} {...form.register("handler")} />
          <TextField label="Execution role" description="IAM role ARN assumed by the function." error={errors.role?.message} {...form.register("role")} />
          <TextField label="Description - optional" className="md:col-span-2" error={errors.description?.message} {...form.register("description")} />
        </div>
      </Panel>
      <Panel title="Code source">
        <Controller
          control={form.control}
          name="code"
          render={({ field }) => (
            <CodeField
              label="Function code"
              value={field.value}
              onChange={field.onChange}
              fileName={codeFileName(handler, runtime)}
              description="The file name is derived from the handler. The AWS SDK and AWS_ENDPOINT_URL are available inside the function."
              error={errors.code?.message}
              rows={16}
            />
          )}
        />
      </Panel>
      <Panel title="General configuration">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Memory (MB)" inputMode="numeric" description="128 MB to 10,240 MB" error={errors.memory?.message} {...form.register("memory")} />
          <TextField label="Timeout (seconds)" inputMode="numeric" description="1 to 900 seconds" error={errors.timeout?.message} {...form.register("timeout")} />
        </div>
      </Panel>
      <Panel title="Environment variables - optional" description="Key-value pairs available to the function code through the process environment.">
        <div className="flex flex-col gap-2">
          <KeyValueEditor rows={env} onChange={setEnv} keyLabel="Key" valueLabel="Value" addLabel="Add environment variable" emptyText="No environment variables." />
          {envError && <p className="text-xs text-aws-red">{envError}</p>}
        </div>
      </Panel>
    </FormPage>
  );
}
