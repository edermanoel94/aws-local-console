"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, SelectField, Table, Td, TextField, Th, Tr } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { SegmentedControl } from "../_shared/controls";
import { plural } from "../_shared/format";
import { RefreshButton } from "../_shared/resource-table";
import { displayValue, type AttributeValue, type DynamoItem } from "./ddb-json";
import { tableKeys, TYPE_LABELS, type TableDescription } from "./ddb-types";
import { ItemEditor } from "./item-editor";

type Mode = "scan" | "query";

interface Request {
  mode: Mode;
  partitionValue?: string;
  sortOperator?: string;
  sortValue?: string;
  sortValueEnd?: string;
}

const SORT_OPERATORS = [
  { value: "", label: "No condition" },
  { value: "=", label: "Equal to" },
  { value: "<", label: "Less than" },
  { value: "<=", label: "Less than or equal to" },
  { value: ">", label: "Greater than" },
  { value: ">=", label: "Greater than or equal to" },
  { value: "between", label: "Between" },
  { value: "begins_with", label: "Begins with" },
];

function keyValue(type: string, value: string): AttributeValue {
  return type === "N" ? { N: value } : type === "B" ? { B: value } : { S: value };
}

function buildInput(table: TableDescription, req: Request): Record<string, unknown> {
  if (req.mode === "scan") return { TableName: table.TableName };
  const keys = tableKeys(table);
  const names: Record<string, string> = { "#pk": keys.partition.name };
  const values: Record<string, AttributeValue> = { ":pk": keyValue(keys.partition.type, req.partitionValue ?? "") };
  let expression = "#pk = :pk";
  if (keys.sort && req.sortOperator && req.sortValue) {
    names["#sk"] = keys.sort.name;
    values[":sk"] = keyValue(keys.sort.type, req.sortValue);
    if (req.sortOperator === "between") {
      values[":sk2"] = keyValue(keys.sort.type, req.sortValueEnd ?? "");
      expression += " AND #sk BETWEEN :sk AND :sk2";
    } else if (req.sortOperator === "begins_with") {
      expression += " AND begins_with(#sk, :sk)";
    } else {
      expression += ` AND #sk ${req.sortOperator} :sk`;
    }
  }
  return { TableName: table.TableName, KeyConditionExpression: expression, ExpressionAttributeNames: names, ExpressionAttributeValues: values };
}

const querySchema = z
  .object({
    mode: z.enum(["scan", "query"]),
    partitionValue: z.string(),
    sortOperator: z.string(),
    sortValue: z.string(),
    sortValueEnd: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== "query") return;
    if (!v.partitionValue.trim()) ctx.addIssue({ code: "custom", path: ["partitionValue"], message: "Enter a partition key value." });
    if (v.sortOperator && !v.sortValue.trim()) ctx.addIssue({ code: "custom", path: ["sortValue"], message: "Enter a sort key value." });
    if (v.sortOperator === "between" && !v.sortValueEnd.trim()) ctx.addIssue({ code: "custom", path: ["sortValueEnd"], message: "Enter the upper bound." });
  });

type QueryForm = z.infer<typeof querySchema>;

export function ItemsExplorer({ table }: { table: TableDescription }) {
  const keys = tableKeys(table);
  const [request, setRequest] = useState<Request>({ mode: "scan" });
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; key: DynamoItem } | null>(null);
  const form = useForm<QueryForm>({ resolver: zodResolver(querySchema), defaultValues: { mode: "scan", partitionValue: "", sortOperator: "", sortValue: "", sortValueEnd: "" } });
  const mode = useWatch({ control: form.control, name: "mode" });
  const sortOperator = useWatch({ control: form.control, name: "sortOperator" });

  const operation = request.mode === "scan" ? "Scan" : "Query";
  const result = useAwsQuery<{ Items?: DynamoItem[] | null; Count?: number; ScannedCount?: number }>("dynamodb", operation, buildInput(table, request));
  const items = result.data?.Items ?? [];

  const keyNames = [keys.partition.name, ...(keys.sort ? [keys.sort.name] : [])];
  const otherNames = [...new Set(items.flatMap((i) => Object.keys(i)))].filter((n) => !keyNames.includes(n)).sort();
  const columns = [...keyNames, ...otherNames.slice(0, 10)];

  return (
    <>
      <Panel title="Scan or query items">
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => setRequest(v.mode === "scan" ? { mode: "scan" } : { mode: "query", partitionValue: v.partitionValue, sortOperator: v.sortOperator, sortValue: v.sortValue, sortValueEnd: v.sortValueEnd }))}
          className="flex flex-col gap-4"
        >
          <SegmentedControl
            legend="Operation"
            name="ddb-operation"
            value={mode}
            onChange={(v) => form.setValue("mode", v)}
            options={[
              { value: "scan", label: "Scan" },
              { value: "query", label: "Query" },
            ]}
            hideLegend
          />
          {mode === "query" && (
            <div className="grid gap-4 md:grid-cols-3">
              <TextField
                label="Partition key value"
                description={`${keys.partition.name} (${TYPE_LABELS[keys.partition.type] ?? keys.partition.type})`}
                placeholder="Enter partition key value"
                error={form.formState.errors.partitionValue?.message}
                {...form.register("partitionValue")}
              />
              {keys.sort && (
                <>
                  <SelectField label="Sort key condition" description={`${keys.sort.name} (${TYPE_LABELS[keys.sort.type] ?? keys.sort.type})`} options={SORT_OPERATORS} {...form.register("sortOperator")} />
                  <div className="flex flex-col gap-2">
                    <TextField label="Sort key value" description="Value compared with the sort key" placeholder="Enter sort key value" disabled={!sortOperator} error={form.formState.errors.sortValue?.message} {...form.register("sortValue")} />
                    {sortOperator === "between" && <TextField label="Sort key upper bound" error={form.formState.errors.sortValueEnd?.message} {...form.register("sortValueEnd")} />}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Run
            </Button>
            <Button
              onClick={() => {
                form.reset();
                setRequest({ mode: "scan" });
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title="Items returned"
        count={result.data ? items.length : undefined}
        description={result.data ? `${operation} returned ${plural(result.data.Count ?? items.length, "item")} (${result.data.ScannedCount ?? items.length} scanned).` : undefined}
        bodyClassName="px-0! py-0!"
        actions={
          <>
            <RefreshButton onClick={() => result.refetch()} spinning={result.isFetching} />
            <Button variant="primary" onClick={() => setEditor({ mode: "create" })}>
              <Plus className="size-4" aria-hidden />
              Create item
            </Button>
          </>
        }
      >
        {result.error ? (
          <div className="px-5 py-4">
            <ErrorAlert error={result.error} />
          </div>
        ) : result.isLoading ? (
          <Loading className="px-5" />
        ) : items.length === 0 ? (
          <EmptyState title="No items" description={request.mode === "scan" ? "This table has no items. Choose Create item to add one." : "No items match the query."} />
        ) : (
          <Table aria-label="Items" className="[&_tbody_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <Th key={c} className={i === 0 ? "pl-5" : undefined}>
                    {c}
                    {c === keys.partition.name && <span className="ml-1 font-normal text-aws-muted">(Partition key)</span>}
                    {c === keys.sort?.name && <span className="ml-1 font-normal text-aws-muted">(Sort key)</span>}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const key: DynamoItem = Object.fromEntries(keyNames.map((k) => [k, item[k]]));
                return (
                  <Tr key={JSON.stringify(key)}>
                    {columns.map((c, i) => (
                      <Td key={c} className={i === 0 ? "pl-5" : undefined}>
                        {i === 0 ? (
                          <button type="button" onClick={() => setEditor({ mode: "edit", key })} className="text-left font-bold break-all text-aws-link hover:underline">
                            {displayValue(item[c])}
                          </button>
                        ) : (
                          <span className="line-clamp-2 max-w-xs font-mono text-xs leading-5 break-all">{item[c] ? displayValue(item[c]) : ""}</span>
                        )}
                      </Td>
                    ))}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      {editor && <ItemEditor table={table} itemKey={editor.mode === "edit" ? editor.key : undefined} onClose={() => setEditor(null)} />}
    </>
  );
}
