"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, SelectField, TextField } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { useConsoleAction } from "../_shared/aws";
import { Checkbox, KeyValueEditor, RadioCards, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { useRegionOptions } from "../_shared/regions";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Bucket name must be between 3 and 63 characters long.")
    .max(63, "Bucket name must be between 3 and 63 characters long.")
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Bucket name can consist only of lowercase letters, numbers, dots (.) and hyphens (-), and must begin and end with a letter or number.")
    .refine((v) => !v.includes(".."), "Bucket name must not contain two adjacent periods.")
    .refine((v) => !/^\d+\.\d+\.\d+\.\d+$/.test(v), "Bucket name must not be formatted as an IP address."),
  region: z.string().min(1),
  eventBridge: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface CreateVars extends FormValues {
  versioning: boolean;
  tags: KeyValue[];
}

export function CreateBucketPage() {
  const { navigate } = useConsoleNav();
  const currentRegion = useRegion();
  const regions = useRegionOptions(currentRegion);
  const [versioning, setVersioning] = useState<"Disabled" | "Enabled">("Disabled");
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", region: currentRegion, eventBridge: false } });

  const create = useConsoleAction<CreateVars>({
    run: async (v, exec) => {
      const opts = { region: v.region };
      await exec("s3", "CreateBucket", {
        Bucket: v.name,
        ...(v.region !== "us-east-1" ? { CreateBucketConfiguration: { LocationConstraint: v.region } } : {}),
      }, opts);
      if (v.versioning) await exec("s3", "PutBucketVersioning", { Bucket: v.name, VersioningConfiguration: { Status: "Enabled" } }, opts);
      const tagSet = v.tags.filter((t) => t.key.trim()).map((t) => ({ Key: t.key.trim(), Value: t.value }));
      if (tagSet.length) await exec("s3", "PutBucketTagging", { Bucket: v.name, Tagging: { TagSet: tagSet } }, opts);
      if (v.eventBridge) await exec("s3", "PutBucketNotificationConfiguration", { Bucket: v.name, NotificationConfiguration: { EventBridgeConfiguration: {} } }, opts);
    },
    successMessage: (v) => `Bucket ${v.name} created`,
    onSuccess: () => navigate({}),
  });

  const { errors } = form.formState;

  return (
    <FormPage
      crumbs={[{ label: "Buckets", to: {} }, { label: "Create bucket" }]}
      title="Create bucket"
      description="Buckets are containers for data stored in S3."
      onSubmit={form.handleSubmit((values) => create.mutate({ ...values, versioning: versioning === "Enabled", tags }))}
      onCancel={() => navigate({})}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="General configuration">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Bucket name"
            placeholder="my-bucket-name"
            autoFocus
            description="Bucket names must be unique and must not contain spaces or uppercase letters."
            error={errors.name?.message}
            {...form.register("name")}
          />
          <SelectField label="AWS Region" options={regions} description="Region where the bucket is created." {...form.register("region")} />
        </div>
      </Panel>
      <Panel title="Bucket Versioning" description="Versioning keeps multiple variants of an object in the same bucket.">
        <RadioCards
          legend="Bucket Versioning"
          name="versioning"
          value={versioning}
          onChange={setVersioning}
          options={[
            { value: "Disabled", label: "Disable" },
            { value: "Enabled", label: "Enable" },
          ]}
        />
      </Panel>
      <Panel title="Event notifications">
        <Checkbox
          label="Send notifications to Amazon EventBridge for all events in this bucket"
          description="EventBridge rules can then route events such as Object Created to queues, functions and topics."
          {...form.register("eventBridge")}
        />
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with the bucket." />
      </Panel>
    </FormPage>
  );
}
