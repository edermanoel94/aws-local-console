"use client";

import type { ReactNode } from "react";
import { get, useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { SelectField, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import { describeKey, PROJECTION_LABELS, TYPE_LABELS, type AttributeDefinition, type IndexKind, type KeySchemaElement, type Projection, type TableKeys } from "./ddb-types";

export const KEY_TYPES = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
];

const PROJECTIONS = (["ALL", "KEYS_ONLY", "INCLUDE"] as const).map((value) => ({ value, label: PROJECTION_LABELS[value] }));

/** DynamoDB limits per table. */
export const MAX_GSI = 20;
export const MAX_LSI = 5;

export const attributeName = z.string().trim().max(255, "Attribute names can be up to 255 characters.");

/** Table and index names share the same rules. */
export function resourceName(kind: "Table" | "Index") {
  const length = `${kind} names must be between 3 and 255 characters long.`;
  return z
    .string()
    .trim()
    .min(3, length)
    .max(255, length)
    .regex(/^[A-Za-z0-9_.-]+$/, `${kind} names can contain only letters, numbers, underscores (_), hyphens (-) and periods (.).`);
}

export const indexSchema = z.object({
  kind: z.enum(["GSI", "LSI"]),
  name: resourceName("Index"),
  partitionKey: attributeName,
  partitionKeyType: z.enum(["S", "N", "B"]),
  sortKey: attributeName,
  sortKeyType: z.enum(["S", "N", "B"]),
  projection: z.enum(["ALL", "KEYS_ONLY", "INCLUDE"]),
  nonKeyAttributes: z.string(),
});

export type IndexFormValues = z.infer<typeof indexSchema>;

export const EMPTY_INDEX: IndexFormValues = {
  kind: "GSI",
  name: "",
  partitionKey: "",
  partitionKeyType: "S",
  sortKey: "",
  sortKeyType: "S",
  projection: "ALL",
  nonKeyAttributes: "",
};

function nonKeyAttributes(text: string): string[] {
  return [...new Set(text.split(",").map((a) => a.trim()).filter(Boolean))];
}

/** Key attributes of the index; an LSI always uses the table's partition key. */
function indexKeyAttributes(v: IndexFormValues, table: TableKeys): AttributeDefinition[] {
  const partition = v.kind === "LSI" ? { AttributeName: table.partition.name, AttributeType: table.partition.type as AttributeDefinition["AttributeType"] } : { AttributeName: v.partitionKey, AttributeType: v.partitionKeyType };
  return v.sortKey ? [partition, { AttributeName: v.sortKey, AttributeType: v.sortKeyType }] : [partition];
}

/**
 * Cross-field rules of one index. `attributeTypes` holds the attribute types already defined (table keys and other indexes),
 * `takenNames` the index names already used; both are updated with this index so the next one is checked against it.
 */
export function validateIndex(
  v: IndexFormValues,
  table: TableKeys,
  context: { attributeTypes: Map<string, string>; takenNames: Set<string> },
  issue: (field: keyof IndexFormValues, message: string) => void,
) {
  if (v.name && context.takenNames.has(v.name)) issue("name", `An index named ${v.name} already exists.`);
  context.takenNames.add(v.name);
  if (v.kind === "GSI" && !v.partitionKey) issue("partitionKey", "Enter a partition key.");
  if (v.kind === "LSI") {
    if (!table.sort) issue("kind", "Local secondary indexes require a table with a sort key.");
    if (!v.sortKey) issue("sortKey", "A local secondary index needs a sort key.");
    else if (v.sortKey === table.sort?.name) issue("sortKey", "The sort key must be different from the table's sort key.");
  }
  const partitionName = v.kind === "LSI" ? table.partition.name : v.partitionKey;
  if (v.sortKey && v.sortKey === partitionName) issue("sortKey", "The sort key must be different from the partition key.");
  if (v.projection === "INCLUDE" && nonKeyAttributes(v.nonKeyAttributes).length === 0) issue("nonKeyAttributes", "Enter at least one attribute to project.");
  for (const [field, attr] of indexKeyAttributes(v, table).map((a, i) => [i === 0 ? "partitionKey" : "sortKey", a] as const)) {
    if (!attr.AttributeName) continue;
    const defined = context.attributeTypes.get(attr.AttributeName);
    if (defined && defined !== attr.AttributeType) issue(field, `Attribute ${attr.AttributeName} is already defined as ${TYPE_LABELS[defined] ?? defined}.`);
    else context.attributeTypes.set(attr.AttributeName, attr.AttributeType);
  }
}

/** CreateTable / UpdateTable shape of the index plus the attribute definitions of its keys. */
export function buildIndex(v: IndexFormValues, table: TableKeys): { attributes: AttributeDefinition[]; index: { IndexName: string; KeySchema: KeySchemaElement[]; Projection: Projection } } {
  const attributes = indexKeyAttributes(v, table);
  return {
    attributes,
    index: {
      IndexName: v.name,
      KeySchema: attributes.map((a, i) => ({ AttributeName: a.AttributeName, KeyType: i === 0 ? "HASH" : "RANGE" })),
      Projection: v.projection === "INCLUDE" ? { ProjectionType: "INCLUDE", NonKeyAttributes: nonKeyAttributes(v.nonKeyAttributes) } : { ProjectionType: v.projection },
    },
  };
}

/**
 * Fields of one secondary index at `name` in the form (e.g. "indexes.0" or "index").
 * `table` gives the table keys an LSI reuses; `allowLocal` shows the index type choice (LSIs can only be created with the table).
 */
export function IndexFields<T extends FieldValues>({ form, name, table, allowLocal, header }: { form: UseFormReturn<T>; name: string; table: TableKeys; allowLocal: boolean; header?: ReactNode }) {
  const path = (field: keyof IndexFormValues) => `${name}.${field}` as Path<T>;
  const error = (field: keyof IndexFormValues): string | undefined => get(form.formState.errors, `${name}.${field}`)?.message;
  const kind = useWatch({ control: form.control, name: path("kind") }) as IndexKind;
  const projection = useWatch({ control: form.control, name: path("projection") }) as IndexFormValues["projection"];
  const local = allowLocal && kind === "LSI";

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex flex-col gap-1">
        <div className={cn("grid items-start gap-4", allowLocal && "md:grid-cols-2")}>
          {allowLocal && (
            <SelectField
              label="Index type"
              options={[
                { value: "GSI", label: "Global secondary index" },
                { value: "LSI", label: "Local secondary index" },
              ]}
              error={error("kind")}
              {...form.register(path("kind"))}
            />
          )}
          <TextField label="Index name" placeholder="e.g. status-index" error={error("name")} {...form.register(path("name"))} />
        </div>
        {allowLocal && (
          <p className="text-xs text-aws-muted">
            {local ? "A local index keeps the table's partition key with an alternate sort key. It can only be created with the table." : "A global index can use any partition and sort key, and can be added or deleted later."}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="grid items-start gap-4 md:grid-cols-[1fr_180px]">
          {local ? (
            <>
              <TextField key="table-partition-key" label="Index partition key" value={table.partition.name} disabled readOnly />
              <TextField key="table-partition-key-type" label="Index partition key type" value={TYPE_LABELS[table.partition.type] ?? table.partition.type} disabled readOnly />
            </>
          ) : (
            <>
              <TextField key="partition-key" label="Index partition key" placeholder="e.g. status" error={error("partitionKey")} {...form.register(path("partitionKey"))} />
              <SelectField key="partition-key-type" label="Index partition key type" options={KEY_TYPES} {...form.register(path("partitionKeyType"))} />
            </>
          )}
        </div>
        {local && <p className="text-xs text-aws-muted">A local secondary index always uses the table&apos;s partition key{table.partition.name ? ` (${describeKey(table.partition)})` : ""}.</p>}
      </div>
      <div className="grid items-start gap-4 md:grid-cols-[1fr_180px]">
        <TextField label="Index sort key" placeholder={local ? "e.g. createdAt" : "Optional, e.g. createdAt"} error={error("sortKey")} {...form.register(path("sortKey"))} />
        <SelectField label="Index sort key type" options={KEY_TYPES} {...form.register(path("sortKeyType"))} />
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <SelectField
          label="Attribute projections"
          description="Table and index keys are always projected."
          options={PROJECTIONS}
          {...form.register(path("projection"))}
        />
        {projection === "INCLUDE" && (
          <TextField
            label="Projected attributes"
            description="Non-key attributes, separated by commas."
            placeholder="e.g. amount, note"
            error={error("nonKeyAttributes")}
            {...form.register(path("nonKeyAttributes"))}
          />
        )}
      </div>
    </div>
  );
}
