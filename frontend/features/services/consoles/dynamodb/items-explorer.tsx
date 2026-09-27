"use client";

import { useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, SelectField, Table, Td, TextField, Th, Tr } from "@/components/ui";
import { useAwsPagedQuery } from "../_shared/aws";
import { Checkbox, SegmentedControl } from "../_shared/controls";
import { plural } from "../_shared/format";
import { RefreshButton } from "../_shared/resource-table";
import { displayValue, type DynamoItem } from "./ddb-json";
import {
  buildItemsInput,
  DEFAULT_REQUEST,
  EMPTY_FILTER,
  FILTER_CONDITIONS,
  FILTER_TYPES,
  filterNeedsValue,
  isNumber,
  isPresenceCondition,
  SORT_OPERATORS,
  type FilterCondition,
  type FilterType,
  type ItemsPage,
  type ItemsRequest,
} from "./ddb-expressions";
import { describeKey, indexKeys, secondaryIndexes, tableKeys, type TableDescription, type TableKeys } from "./ddb-types";
import { ItemEditor } from "./item-editor";

const BOOLEAN_OPTIONS = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

/** Validates a key or filter value of the given type and returns the error message, if any. */
function valueError(type: string, value: string, what: string): string | undefined {
  if (type === "N" && !isNumber(value)) return `${what} must be a number.`;
  if ((type === "B" || type === "N") && !value.trim()) return `Enter ${what.toLowerCase()}.`;
  return undefined;
}

function makeSchema(table: TableDescription) {
  return z
    .object({
      mode: z.enum(["scan", "query"]),
      index: z.string(),
      partitionValue: z.string(),
      sortOperator: z.string(),
      sortValue: z.string(),
      sortValueEnd: z.string(),
      filters: z.array(
        z.object({
          attribute: z.string(),
          type: z.enum(FILTER_TYPES.map((t) => t.value) as [FilterType, ...FilterType[]]),
          condition: z.enum(FILTER_CONDITIONS.map((c) => c.value) as [FilterCondition, ...FilterCondition[]]),
          value: z.string(),
          valueEnd: z.string(),
        }),
      ),
      descending: z.boolean(),
      limit: z
        .string()
        .trim()
        .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 2147483647), "Page size must be a positive integer."),
    })
    .superRefine((v, ctx) => {
      const issue = (path: (string | number)[], message: string | undefined) => {
        if (message) ctx.addIssue({ code: "custom", path, message });
      };
      const queried = indexKeys(table, v.index);
      const queriedKeyNames = v.mode === "query" ? [queried.partition.name, queried.sort?.name] : [];
      if (v.mode === "query") {
        const keys = queried;
        issue(["partitionValue"], v.partitionValue.trim() ? valueError(keys.partition.type, v.partitionValue, "Partition key value") : "Enter a partition key value.");
        if (keys.sort && v.sortOperator) {
          issue(["sortValue"], v.sortValue.trim() ? valueError(keys.sort.type, v.sortValue, "Sort key value") : "Enter a sort key value.");
          if (v.sortOperator === "between") issue(["sortValueEnd"], v.sortValueEnd.trim() ? valueError(keys.sort.type, v.sortValueEnd, "Upper bound") : "Enter the upper bound.");
        }
      }
      v.filters.forEach((f, i) => {
        const attribute = f.attribute.trim();
        // DynamoDB rejects filters on the key attributes of the queried table or index: those belong in the key condition.
        issue(["filters", i, "attribute"], !attribute ? "Enter an attribute name." : queriedKeyNames.includes(attribute) ? `${attribute} is a key of the queried ${v.index ? "index" : "table"}. Use the key condition instead.` : undefined);
        if (!filterNeedsValue(f)) return;
        issue(["filters", i, "value"], valueError(f.type, f.value, "Value"));
        if (f.condition === "between") issue(["filters", i, "valueEnd"], valueError(f.type, f.valueEnd, "Upper bound"));
      });
    });
}

/** Explore items: Scan or Query the table or one of its secondary indexes, with filters, order and pagination. */
export function ItemsExplorer({ table }: { table: TableDescription }) {
  const indexes = secondaryIndexes(table);
  const schema = useMemo(() => makeSchema(table), [table]);
  const form = useForm<ItemsRequest>({ resolver: zodResolver(schema), defaultValues: DEFAULT_REQUEST });
  const [request, setRequest] = useState<ItemsRequest>(DEFAULT_REQUEST);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; key: DynamoItem } | null>(null);
  const mode = useWatch({ control: form.control, name: "mode" });
  const index = useWatch({ control: form.control, name: "index" });
  const sortOperator = useWatch({ control: form.control, name: "sortOperator" });
  const formKeys = indexKeys(table, index);

  const operation = request.mode === "scan" ? "Scan" : "Query";
  const input = useMemo(() => buildItemsInput(table, request), [table, request]);
  const result = useAwsPagedQuery<ItemsPage, DynamoItem>("dynamodb", operation, input, {
    next: (page) => (page.LastEvaluatedKey && Object.keys(page.LastEvaluatedKey).length ? page.LastEvaluatedKey : undefined),
    tokenField: "ExclusiveStartKey",
  });
  const pages = result.data?.pages ?? [];
  const items = pages.flatMap((p) => p.Items ?? []);
  const count = pages.reduce((n, p) => n + (p.Count ?? p.Items?.length ?? 0), 0);
  const scanned = pages.reduce((n, p) => n + (p.ScannedCount ?? p.Items?.length ?? 0), 0);

  // Running the same request again must hit Floci again from the first page: an unchanged query key would otherwise serve the cached pages.
  const run = (next: ItemsRequest) => {
    if (JSON.stringify(next) === JSON.stringify(request)) void result.restart();
    else setRequest(next);
  };

  const keys = tableKeys(table);
  const requestKeys = indexKeys(table, request.index);
  const keyNames = [...new Set([keys.partition.name, keys.sort?.name, requestKeys.partition.name, requestKeys.sort?.name].filter((n): n is string => !!n))];
  const otherNames = [...new Set(items.flatMap((i) => Object.keys(i)))].filter((n) => !keyNames.includes(n)).sort();
  const columns = [...keyNames, ...otherNames.slice(0, 10)];
  const keyLabel = (name: string) => {
    if (name === keys.partition.name) return "Partition key";
    if (name === keys.sort?.name) return "Sort key";
    if (name === requestKeys.partition.name) return "Index partition key";
    if (name === requestKeys.sort?.name) return "Index sort key";
    return undefined;
  };
  const plainScan = request.mode === "scan" && !request.index && request.filters.length === 0;

  return (
    <>
      <Panel title="Scan or query items">
        <form noValidate onSubmit={form.handleSubmit(run)} className="flex flex-col gap-4">
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
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField
              label="Table or index"
              description={mode === "scan" ? "Scan reads every item of the table or index." : "Query reads the items of one partition key value."}
              options={[
                { value: "", label: `Table: ${table.TableName}` },
                ...indexes.map((i) => ({ value: i.IndexName, label: `${i.kind}: ${i.IndexName}` })),
              ]}
              {...form.register("index", {
                // Key names and types change with the index: start its key condition from scratch.
                onChange: () => {
                  for (const field of ["partitionValue", "sortOperator", "sortValue", "sortValueEnd"] as const) form.setValue(field, "");
                  form.clearErrors(["partitionValue", "sortValue", "sortValueEnd"]);
                },
              })}
            />
          </div>
          {mode === "query" && (
            <>
              <KeyConditionFields form={form} keys={formKeys} sortOperator={sortOperator} />
              <Checkbox label="Sort descending" description="Return items in descending sort key order." {...form.register("descending")} />
            </>
          )}
          <FilterFields form={form} />
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label="Page size (Limit) - optional"
              description="Items read per request. Empty reads up to 1 MB."
              inputMode="numeric"
              placeholder="e.g. 50"
              error={form.formState.errors.limit?.message}
              {...form.register("limit")}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              Run
            </Button>
            <Button
              onClick={() => {
                form.reset(DEFAULT_REQUEST);
                setRequest(DEFAULT_REQUEST);
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
        description={
          result.data
            ? `${operation}${request.index ? ` on index ${request.index}` : ""} returned ${plural(count, "item")} (${scanned} scanned)${result.hasNextPage ? ". More items are available." : "."}`
            : undefined
        }
        bodyClassName="px-0! py-0!"
        actions={
          <>
            <RefreshButton onClick={() => result.refetch()} spinning={result.isFetching && !result.isFetchingNextPage} />
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
          <EmptyState
            title="No items"
            description={
              result.hasNextPage
                ? "No items matched in the pages read so far. Choose Load more items to keep reading."
                : plainScan
                  ? "This table has no items. Choose Create item to add one."
                  : "No items match the request."
            }
          />
        ) : (
          <Table aria-label="Items" className={result.hasNextPage ? undefined : "[&_tbody_tr:last-child_td]:border-b-0"}>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <Th key={c} className={i === 0 ? "pl-5" : undefined}>
                    {c}
                    {/* A real space (not a margin) so the accessible name reads "orderId (Sort key)", like the visible text. */}
                    {keyLabel(c) && <span className="font-normal text-aws-muted"> ({keyLabel(c)})</span>}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                // Indexes always project the table's key attributes, so every returned item can be opened by its table key.
                const key: DynamoItem = Object.fromEntries([keys.partition.name, ...(keys.sort ? [keys.sort.name] : [])].map((k) => [k, item[k]]));
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
        {!result.error && result.hasNextPage && (
          <div className="flex justify-center px-5 py-3">
            <Button onClick={() => result.fetchNextPage()} loading={result.isFetchingNextPage}>
              Load more items
            </Button>
          </div>
        )}
      </Panel>
      {editor && <ItemEditor table={table} itemKey={editor.mode === "edit" ? editor.key : undefined} onClose={() => setEditor(null)} />}
    </>
  );
}

function KeyConditionFields({ form, keys, sortOperator }: { form: UseFormReturn<ItemsRequest>; keys: TableKeys; sortOperator: string }) {
  const { errors } = form.formState;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <TextField
        label="Partition key value"
        description={describeKey(keys.partition)}
        placeholder="Enter partition key value"
        error={errors.partitionValue?.message}
        {...form.register("partitionValue")}
      />
      {keys.sort && (
        <>
          <SelectField label="Sort key condition" description={describeKey(keys.sort)} options={SORT_OPERATORS} {...form.register("sortOperator")} />
          <div className="flex flex-col gap-2">
            <TextField
              label="Sort key value"
              description="Value compared with the sort key"
              placeholder="Enter sort key value"
              disabled={!sortOperator}
              error={errors.sortValue?.message}
              {...form.register("sortValue")}
            />
            {sortOperator === "between" && <TextField label="Sort key upper bound" error={errors.sortValueEnd?.message} {...form.register("sortValueEnd")} />}
          </div>
        </>
      )}
    </div>
  );
}

/** Filter conditions (FilterExpression), combined with AND. Each row is a group named "Filter N". */
function FilterFields({ form }: { form: UseFormReturn<ItemsRequest> }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "filters" });
  const filters = useWatch({ control: form.control, name: "filters" });
  const errors = form.formState.errors.filters;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-bold text-aws-ink">Filters - optional</h3>
        <p className="text-xs text-aws-muted">Filters are applied after items are read, so they reduce the items returned but not the items scanned. All filters must match.</p>
      </div>
      {fields.map((field, i) => {
        const filter = filters?.[i] ?? field;
        const presence = isPresenceCondition(filter.condition);
        return (
          <div
            key={field.id}
            role="group"
            aria-label={`Filter ${i + 1}`}
            className="grid items-start gap-3 rounded-lg border border-aws-border bg-aws-panel/40 p-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem_minmax(0,1fr)_auto]"
          >
            <TextField label="Attribute name" placeholder="e.g. status" error={errors?.[i]?.attribute?.message} {...form.register(`filters.${i}.attribute`)} />
            <SelectField
              label="Type"
              options={[...FILTER_TYPES]}
              disabled={presence}
              {...form.register(`filters.${i}.type`, {
                onChange: (e) => {
                  if (e.target.value === "BOOL" && filter.value !== "true" && filter.value !== "false") form.setValue(`filters.${i}.value`, "true");
                },
              })}
            />
            <SelectField label="Condition" options={[...FILTER_CONDITIONS]} {...form.register(`filters.${i}.condition`)} />
            <div className="flex flex-col gap-2">
              {filterNeedsValue(filter) &&
                (filter.type === "BOOL" ? (
                  <SelectField label="Value" options={BOOLEAN_OPTIONS} {...form.register(`filters.${i}.value`)} />
                ) : (
                  <>
                    <TextField label="Value" placeholder="Enter value" error={errors?.[i]?.value?.message} {...form.register(`filters.${i}.value`)} />
                    {filter.condition === "between" && <TextField label="Upper bound" placeholder="Enter upper bound" error={errors?.[i]?.valueEnd?.message} {...form.register(`filters.${i}.valueEnd`)} />}
                  </>
                ))}
            </div>
            <Button className="justify-self-start md:mt-6" aria-label={`Remove filter ${i + 1}`} onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
        );
      })}
      <div>
        <Button onClick={() => append({ ...EMPTY_FILTER })}>
          <Plus className="size-4" aria-hidden />
          Add filter
        </Button>
      </div>
    </div>
  );
}
