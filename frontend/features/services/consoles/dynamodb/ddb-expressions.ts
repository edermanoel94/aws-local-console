/**
 * Builds Scan and Query inputs (key condition, filter expression, index, order and page size)
 * from the Explore items form. Attribute names and values always go through placeholders,
 * so reserved words ("status", "name", ...) and special characters work.
 */

import type { AttributeValue, DynamoItem } from "./ddb-json";
import { indexKeys, type TableDescription } from "./ddb-types";

export type ItemsMode = "scan" | "query";

export const SORT_OPERATORS = [
  { value: "", label: "No condition" },
  { value: "=", label: "Equal to" },
  { value: "<", label: "Less than" },
  { value: "<=", label: "Less than or equal to" },
  { value: ">", label: "Greater than" },
  { value: ">=", label: "Greater than or equal to" },
  { value: "between", label: "Between" },
  { value: "begins_with", label: "Begins with" },
];

export const FILTER_TYPES = [
  { value: "S", label: "String" },
  { value: "N", label: "Number" },
  { value: "B", label: "Binary" },
  { value: "BOOL", label: "Boolean" },
  { value: "NULL", label: "Null" },
] as const;

export type FilterType = (typeof FILTER_TYPES)[number]["value"];

export const FILTER_CONDITIONS = [
  { value: "=", label: "Equal to" },
  { value: "<>", label: "Not equal to" },
  { value: "<", label: "Less than" },
  { value: "<=", label: "Less than or equal to" },
  { value: ">", label: "Greater than" },
  { value: ">=", label: "Greater than or equal to" },
  { value: "between", label: "Between" },
  { value: "exists", label: "Exists" },
  { value: "not_exists", label: "Not exists" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not contains" },
  { value: "begins_with", label: "Begins with" },
] as const;

export type FilterCondition = (typeof FILTER_CONDITIONS)[number]["value"];

export interface ItemFilter {
  attribute: string;
  type: FilterType;
  condition: FilterCondition;
  value: string;
  valueEnd: string;
}

export interface ItemsRequest {
  mode: ItemsMode;
  /** Secondary index name; empty for the table itself. */
  index: string;
  partitionValue: string;
  sortOperator: string;
  sortValue: string;
  sortValueEnd: string;
  filters: ItemFilter[];
  /** Query only: ScanIndexForward = false. */
  descending: boolean;
  /** Page size (Limit), empty for DynamoDB's default of up to 1 MB per page. */
  limit: string;
}

export const EMPTY_FILTER: ItemFilter = { attribute: "", type: "S", condition: "=", value: "", valueEnd: "" };

export const DEFAULT_REQUEST: ItemsRequest = {
  mode: "scan",
  index: "",
  partitionValue: "",
  sortOperator: "",
  sortValue: "",
  sortValueEnd: "",
  filters: [],
  descending: false,
  limit: "",
};

/** Conditions that only test the presence of the attribute, so they take no type or value. */
export function isPresenceCondition(condition: FilterCondition): boolean {
  return condition === "exists" || condition === "not_exists";
}

/** Whether the filter needs a typed value (and so a value input). */
export function filterNeedsValue(filter: Pick<ItemFilter, "type" | "condition">): boolean {
  return !isPresenceCondition(filter.condition) && filter.type !== "NULL";
}

export function typedValue(type: string, text: string): AttributeValue {
  switch (type) {
    case "N":
      return { N: text.trim() };
    case "B":
      return { B: text.trim() };
    case "BOOL":
      return { BOOL: text === "true" };
    case "NULL":
      return { NULL: true };
    default:
      return { S: text };
  }
}

export function isNumber(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

class Placeholders {
  names: Record<string, string> = {};
  values: Record<string, AttributeValue> = {};

  name(placeholder: string, attribute: string) {
    this.names[placeholder] = attribute;
    return placeholder;
  }

  value(placeholder: string, value: AttributeValue) {
    this.values[placeholder] = value;
    return placeholder;
  }
}

function filterExpression(filters: ItemFilter[], p: Placeholders): string | undefined {
  const parts = filters.map((f, i) => {
    const name = p.name(`#f${i}`, f.attribute.trim());
    const value = () => p.value(`:f${i}`, typedValue(f.type, f.value));
    switch (f.condition) {
      case "exists":
        return `attribute_exists(${name})`;
      case "not_exists":
        return `attribute_not_exists(${name})`;
      case "between":
        return `${name} BETWEEN ${value()} AND ${p.value(`:f${i}b`, typedValue(f.type, f.valueEnd))}`;
      case "contains":
        return `contains(${name}, ${value()})`;
      case "not_contains":
        return `NOT contains(${name}, ${value()})`;
      case "begins_with":
        return `begins_with(${name}, ${value()})`;
      default:
        return `${name} ${f.condition} ${value()}`;
    }
  });
  return parts.length ? parts.join(" AND ") : undefined;
}

/** Scan or Query input of the first page; pass `ExclusiveStartKey` for the next ones. */
export function buildItemsInput(table: TableDescription, req: ItemsRequest): Record<string, unknown> {
  const p = new Placeholders();
  const input: Record<string, unknown> = { TableName: table.TableName };
  if (req.index) input.IndexName = req.index;

  if (req.mode === "query") {
    const keys = indexKeys(table, req.index);
    let expression = `${p.name("#pk", keys.partition.name)} = ${p.value(":pk", typedValue(keys.partition.type, req.partitionValue))}`;
    if (keys.sort && req.sortOperator) {
      const sk = p.name("#sk", keys.sort.name);
      const value = p.value(":sk", typedValue(keys.sort.type, req.sortValue));
      if (req.sortOperator === "between") expression += ` AND ${sk} BETWEEN ${value} AND ${p.value(":sk2", typedValue(keys.sort.type, req.sortValueEnd))}`;
      else if (req.sortOperator === "begins_with") expression += ` AND begins_with(${sk}, ${value})`;
      else expression += ` AND ${sk} ${req.sortOperator} ${value}`;
    }
    input.KeyConditionExpression = expression;
    if (req.descending) input.ScanIndexForward = false;
  }

  const filter = filterExpression(req.filters, p);
  if (filter) input.FilterExpression = filter;
  if (req.limit.trim()) input.Limit = Number(req.limit);
  if (Object.keys(p.names).length) input.ExpressionAttributeNames = p.names;
  if (Object.keys(p.values).length) input.ExpressionAttributeValues = p.values;
  return input;
}

export interface ItemsPage {
  Items?: DynamoItem[] | null;
  Count?: number;
  ScannedCount?: number;
  LastEvaluatedKey?: DynamoItem | null;
}
