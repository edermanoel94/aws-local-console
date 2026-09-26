"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, SelectField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import type { RestApi } from "./apigw-types";

const schema = z.object({
  name: z.string().trim().min(1, "Enter an API name.").max(128, "API names can be up to 128 characters."),
  description: z.string().max(1024),
  endpointType: z.enum(["REGIONAL", "EDGE", "PRIVATE"]),
});

type FormValues = z.infer<typeof schema>;

export function CreateApiPage() {
  const { navigate } = useConsoleNav();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", endpointType: "REGIONAL" } });

  const create = useConsoleAction<FormValues, RestApi>({
    run: (v, exec) =>
      exec<RestApi>("apigateway", "CreateRestApi", {
        Name: v.name,
        ...(v.description ? { Description: v.description } : {}),
        EndpointConfiguration: { Types: [v.endpointType] },
      }),
    successMessage: (v) => `API ${v.name} created`,
    onSuccess: (api) => navigate({ resource: api.Id }),
  });

  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "APIs", to: {} }, { label: "Create REST API" }]}
      title="Create REST API"
      description="Create a new REST API. Add resources and methods, then deploy it to a stage."
      onSubmit={form.handleSubmit((v) => create.mutate(v))}
      onCancel={() => navigate({})}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="API details">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="API name" placeholder="payments-api" autoFocus error={errors.name?.message} {...form.register("name")} />
          <SelectField
            label="API endpoint type"
            options={[
              { value: "REGIONAL", label: "Regional" },
              { value: "EDGE", label: "Edge-optimized" },
              { value: "PRIVATE", label: "Private" },
            ]}
            {...form.register("endpointType")}
          />
          <TextField label="Description - optional" className="md:col-span-2" error={errors.description?.message} {...form.register("description")} />
        </div>
      </Panel>
    </FormPage>
  );
}
