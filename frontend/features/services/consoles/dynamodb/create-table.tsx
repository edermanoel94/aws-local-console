"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Panel, SelectField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { KeyValueEditor, RadioCards, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { requiredInt } from "../_shared/validation";

const KEY_TYPES = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
];

const attributeName = z.string().trim().max(255, "Attribute names can be up to 255 characters.");

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Table names must be between 3 and 255 characters long.")
      .max(255, "Table names must be between 3 and 255 characters long.")
      .regex(/^[A-Za-z0-9_.-]+$/, "Table names can contain only letters, numbers, underscores (_), hyphens (-) and periods (.)."),
    partitionKey: attributeName.min(1, "Enter a partition key."),
    partitionKeyType: z.enum(["S", "N", "B"]),
    sortKey: attributeName,
    sortKeyType: z.enum(["S", "N", "B"]),
    billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]),
    readCapacity: requiredInt(1, 40000, "Read capacity units"),
    writeCapacity: requiredInt(1, 40000, "Write capacity units"),
  })
  .refine((v) => !v.sortKey || v.sortKey !== v.partitionKey, { path: ["sortKey"], message: "The sort key must be different from the partition key." });

type FormValues = z.infer<typeof schema>;

export function CreateTablePage() {
  const { navigate } = useConsoleNav();
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", partitionKey: "", partitionKeyType: "S", sortKey: "", sortKeyType: "S", billingMode: "PAY_PER_REQUEST", readCapacity: "5", writeCapacity: "5" },
  });
  const billingMode = useWatch({ control: form.control, name: "billingMode" });

  const create = useConsoleAction<FormValues>({
    run: (v, exec) => {
      const attributes = [{ AttributeName: v.partitionKey, AttributeType: v.partitionKeyType }];
      const keySchema = [{ AttributeName: v.partitionKey, KeyType: "HASH" }];
      if (v.sortKey) {
        attributes.push({ AttributeName: v.sortKey, AttributeType: v.sortKeyType });
        keySchema.push({ AttributeName: v.sortKey, KeyType: "RANGE" });
      }
      const tagList = tags.filter((t) => t.key.trim()).map((t) => ({ Key: t.key.trim(), Value: t.value }));
      return exec("dynamodb", "CreateTable", {
        TableName: v.name,
        AttributeDefinitions: attributes,
        KeySchema: keySchema,
        BillingMode: v.billingMode,
        ...(v.billingMode === "PROVISIONED" ? { ProvisionedThroughput: { ReadCapacityUnits: Number(v.readCapacity), WriteCapacityUnits: Number(v.writeCapacity) } } : {}),
        ...(tagList.length ? { Tags: tagList } : {}),
      });
    },
    successMessage: (v) => `Table ${v.name} created`,
    onSuccess: (_, v) => navigate({ resource: v.name }),
  });

  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "Tables", to: {} }, { label: "Create table" }]}
      title="Create table"
      onSubmit={form.handleSubmit((v) => create.mutate(v))}
      onCancel={() => navigate({})}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="Table details" description="DynamoDB is a schemaless database that only requires a table name and a primary key when you create the table.">
        <div className="flex flex-col gap-4">
          <TextField label="Table name" placeholder="orders" autoFocus description="Between 3 and 255 characters." error={errors.name?.message} {...form.register("name")} />
          <div className="flex flex-col gap-1">
            <div className="grid items-start gap-4 md:grid-cols-[1fr_180px]">
              <TextField label="Partition key" placeholder="id" error={errors.partitionKey?.message} {...form.register("partitionKey")} />
              <SelectField label="Partition key type" options={KEY_TYPES} {...form.register("partitionKeyType")} />
            </div>
            <p className="text-xs text-aws-muted">The partition key is part of the table&apos;s primary key. It is a hash value used to retrieve items.</p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="grid items-start gap-4 md:grid-cols-[1fr_180px]">
              <TextField label="Sort key" placeholder="Optional, e.g. createdAt" error={errors.sortKey?.message} {...form.register("sortKey")} />
              <SelectField label="Sort key type" options={KEY_TYPES} {...form.register("sortKeyType")} />
            </div>
            <p className="text-xs text-aws-muted">Optional. The sort key is the second part of the primary key and allows range queries.</p>
          </div>
        </div>
      </Panel>
      <Panel title="Table settings">
        <div className="flex flex-col gap-4">
          <Controller
            control={form.control}
            name="billingMode"
            render={({ field }) => (
              <RadioCards
                legend="Capacity mode"
                name="billing-mode"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: "PAY_PER_REQUEST", label: "On-demand", description: "Pay per request, no capacity planning." },
                  { value: "PROVISIONED", label: "Provisioned", description: "Specify read and write capacity units." },
                ]}
              />
            )}
          />
          {billingMode === "PROVISIONED" && (
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Read capacity units" inputMode="numeric" error={errors.readCapacity?.message} {...form.register("readCapacity")} />
              <TextField label="Write capacity units" inputMode="numeric" error={errors.writeCapacity?.message} {...form.register("writeCapacity")} />
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with this table." />
      </Panel>
    </FormPage>
  );
}
