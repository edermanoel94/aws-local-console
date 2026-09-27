"use client";

import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button, Panel, SelectField, TextField } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { Checkbox, KeyValueEditor, RadioCards, type KeyValue } from "../_shared/controls";
import { FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { requiredInt } from "../_shared/validation";
import { STREAM_VIEW_TYPES, type AttributeDefinition, type TableKeys } from "./ddb-types";
import { attributeName, buildIndex, EMPTY_INDEX, IndexFields, indexSchema, KEY_TYPES, MAX_GSI, MAX_LSI, resourceName, validateIndex } from "./index-form";

const schema = z
  .object({
    name: resourceName("Table"),
    partitionKey: attributeName.min(1, "Enter a partition key."),
    partitionKeyType: z.enum(["S", "N", "B"]),
    sortKey: attributeName,
    sortKeyType: z.enum(["S", "N", "B"]),
    billingMode: z.enum(["PAY_PER_REQUEST", "PROVISIONED"]),
    readCapacity: requiredInt(1, 40000, "Read capacity units"),
    writeCapacity: requiredInt(1, 40000, "Write capacity units"),
    indexes: z.array(indexSchema),
    streamEnabled: z.boolean(),
    streamViewType: z.enum(["KEYS_ONLY", "NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES"]),
  })
  .superRefine((v, ctx) => {
    if (v.sortKey && v.sortKey === v.partitionKey) ctx.addIssue({ code: "custom", path: ["sortKey"], message: "The sort key must be different from the partition key." });
    const table = tableKeysOf(v);
    const context = {
      attributeTypes: new Map<string, string>([[v.partitionKey, v.partitionKeyType], ...(v.sortKey ? [[v.sortKey, v.sortKeyType] as [string, string]] : [])]),
      takenNames: new Set<string>(),
    };
    v.indexes.forEach((index, i) => validateIndex(index, table, context, (field, message) => ctx.addIssue({ code: "custom", path: ["indexes", i, field], message })));
    const count = (kind: string) => v.indexes.filter((i) => i.kind === kind).length;
    if (count("GSI") > MAX_GSI) ctx.addIssue({ code: "custom", path: ["indexes"], message: `A table can have up to ${MAX_GSI} global secondary indexes.` });
    if (count("LSI") > MAX_LSI) ctx.addIssue({ code: "custom", path: ["indexes"], message: `A table can have up to ${MAX_LSI} local secondary indexes.` });
  });

type FormValues = z.infer<typeof schema>;

function tableKeysOf(v: Pick<FormValues, "partitionKey" | "partitionKeyType" | "sortKey" | "sortKeyType">): TableKeys {
  return { partition: { name: v.partitionKey, type: v.partitionKeyType }, sort: v.sortKey ? { name: v.sortKey, type: v.sortKeyType } : undefined };
}

export function CreateTablePage() {
  const { navigate } = useConsoleNav();
  const [tags, setTags] = useState<KeyValue[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", partitionKey: "", partitionKeyType: "S", sortKey: "", sortKeyType: "S", billingMode: "PAY_PER_REQUEST", readCapacity: "5", writeCapacity: "5", indexes: [], streamEnabled: false, streamViewType: "NEW_AND_OLD_IMAGES" },
  });
  const billingMode = useWatch({ control: form.control, name: "billingMode" });
  const streamOn = useWatch({ control: form.control, name: "streamEnabled" });
  const [partitionKey, partitionKeyType, sortKey, sortKeyType] = useWatch({ control: form.control, name: ["partitionKey", "partitionKeyType", "sortKey", "sortKeyType"] });
  const indexes = useFieldArray({ control: form.control, name: "indexes" });

  const create = useConsoleAction<FormValues>({
    run: (v, exec) => {
      const attributes: AttributeDefinition[] = [{ AttributeName: v.partitionKey, AttributeType: v.partitionKeyType }];
      const keySchema = [{ AttributeName: v.partitionKey, KeyType: "HASH" }];
      if (v.sortKey) {
        attributes.push({ AttributeName: v.sortKey, AttributeType: v.sortKeyType });
        keySchema.push({ AttributeName: v.sortKey, KeyType: "RANGE" });
      }
      const throughput = v.billingMode === "PROVISIONED" ? { ProvisionedThroughput: { ReadCapacityUnits: Number(v.readCapacity), WriteCapacityUnits: Number(v.writeCapacity) } } : {};
      const built = v.indexes.map((i) => ({ kind: i.kind, ...buildIndex(i, tableKeysOf(v)) }));
      for (const a of built.flatMap((b) => b.attributes)) if (!attributes.some((d) => d.AttributeName === a.AttributeName)) attributes.push(a);
      // Provisioned global indexes get the table's capacity, like the AWS console's default.
      const globalIndexes = built.filter((b) => b.kind === "GSI").map((b) => ({ ...b.index, ...throughput }));
      const localIndexes = built.filter((b) => b.kind === "LSI").map((b) => b.index);
      const tagList = tags.filter((t) => t.key.trim()).map((t) => ({ Key: t.key.trim(), Value: t.value }));
      return exec("dynamodb", "CreateTable", {
        TableName: v.name,
        AttributeDefinitions: attributes,
        KeySchema: keySchema,
        BillingMode: v.billingMode,
        ...throughput,
        ...(globalIndexes.length ? { GlobalSecondaryIndexes: globalIndexes } : {}),
        ...(localIndexes.length ? { LocalSecondaryIndexes: localIndexes } : {}),
        ...(v.streamEnabled ? { StreamSpecification: { StreamEnabled: true, StreamViewType: v.streamViewType } } : {}),
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
          <Checkbox label="Turn on DynamoDB stream" description="Capture a time-ordered record of every item change, for Lambda triggers or change data capture." {...form.register("streamEnabled")} />
          {streamOn && (
            <Controller
              control={form.control}
              name="streamViewType"
              render={({ field }) => <RadioCards legend="Stream view type" name="stream-view-type" value={field.value} onChange={field.onChange} options={STREAM_VIEW_TYPES} />}
            />
          )}
        </div>
      </Panel>
      <Panel
        title="Secondary indexes - optional"
        description="Indexes let you query the table by alternate keys. Global indexes can also be added later; local indexes only now."
      >
        <div className="flex flex-col gap-4">
          {indexes.fields.length === 0 && <p className="text-sm text-aws-muted">No secondary indexes.</p>}
          {indexes.fields.map((field, i) => (
            <div key={field.id} role="group" aria-label={`Secondary index ${i + 1}`} className="rounded-lg border border-aws-border p-4">
              <IndexFields
                form={form}
                name={`indexes.${i}`}
                table={tableKeysOf({ partitionKey, partitionKeyType, sortKey, sortKeyType })}
                allowLocal
                header={
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">Secondary index {i + 1}</h3>
                    <Button size="sm" aria-label={`Remove secondary index ${i + 1}`} onClick={() => indexes.remove(i)}>
                      Remove
                    </Button>
                  </div>
                }
              />
            </div>
          ))}
          {errors.indexes?.root?.message || errors.indexes?.message ? <p className="text-xs text-aws-red">{errors.indexes?.root?.message ?? errors.indexes?.message}</p> : null}
          <div>
            <Button onClick={() => indexes.append({ ...EMPTY_INDEX })}>
              <Plus className="size-4" aria-hidden />
              Add index
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="Tags - optional">
        <KeyValueEditor rows={tags} onChange={setTags} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" emptyText="No tags associated with this table." />
      </Panel>
    </FormPage>
  );
}
