import type { Exec } from "../_shared/aws";

export interface KeySchemaElement {
  AttributeName: string;
  KeyType: "HASH" | "RANGE";
}

export interface AttributeDefinition {
  AttributeName: string;
  AttributeType: "S" | "N" | "B";
}

export interface Projection {
  ProjectionType?: "ALL" | "KEYS_ONLY" | "INCLUDE";
  NonKeyAttributes?: string[] | null;
}

export interface SecondaryIndexDescription {
  IndexName: string;
  KeySchema: KeySchemaElement[];
  Projection?: Projection;
  ItemCount?: number;
}

export interface TableDescription {
  TableName: string;
  TableArn?: string;
  TableStatus?: string;
  KeySchema?: KeySchemaElement[];
  AttributeDefinitions?: AttributeDefinition[];
  ItemCount?: number;
  TableSizeBytes?: number;
  CreationDateTime?: string;
  BillingModeSummary?: { BillingMode?: string } | null;
  ProvisionedThroughput?: { ReadCapacityUnits?: number; WriteCapacityUnits?: number } | null;
  GlobalSecondaryIndexes?: (SecondaryIndexDescription & { IndexStatus?: string })[] | null;
  LocalSecondaryIndexes?: SecondaryIndexDescription[] | null;
  StreamSpecification?: { StreamEnabled?: boolean; StreamViewType?: StreamViewType } | null;
  LatestStreamArn?: string | null;
  LatestStreamLabel?: string | null;
}

export interface TableKeys {
  partition: { name: string; type: string };
  sort?: { name: string; type: string };
}

function keysOf(table: TableDescription, keySchema: KeySchemaElement[] | undefined): TableKeys {
  const typeOf = (name: string) => table.AttributeDefinitions?.find((a) => a.AttributeName === name)?.AttributeType ?? "S";
  const hash = keySchema?.find((k) => k.KeyType === "HASH")?.AttributeName ?? "";
  const range = keySchema?.find((k) => k.KeyType === "RANGE")?.AttributeName;
  return { partition: { name: hash, type: typeOf(hash) }, sort: range ? { name: range, type: typeOf(range) } : undefined };
}

export function tableKeys(table: TableDescription): TableKeys {
  return keysOf(table, table.KeySchema);
}

export type IndexKind = "GSI" | "LSI";

export interface SecondaryIndex extends SecondaryIndexDescription {
  kind: IndexKind;
  IndexStatus?: string;
}

/** Global and local secondary indexes of the table, GSIs first. */
export function secondaryIndexes(table: TableDescription): SecondaryIndex[] {
  return [
    ...(table.GlobalSecondaryIndexes ?? []).map((i) => ({ ...i, kind: "GSI" as const })),
    // LSIs are built with the table, so they are always active.
    ...(table.LocalSecondaryIndexes ?? []).map((i) => ({ ...i, kind: "LSI" as const, IndexStatus: "ACTIVE" })),
  ];
}

/** Key schema of a secondary index, or of the table itself when `indexName` is empty. */
export function indexKeys(table: TableDescription, indexName?: string): TableKeys {
  if (!indexName) return tableKeys(table);
  return keysOf(table, secondaryIndexes(table).find((i) => i.IndexName === indexName)?.KeySchema);
}

export function describeKey(key: { name: string; type: string }): string {
  return `${key.name} (${TYPE_LABELS[key.type] ?? key.type})`;
}

export const PROJECTION_LABELS: Record<string, string> = { ALL: "All", KEYS_ONLY: "Keys only", INCLUDE: "Include" };

export const TYPE_LABELS: Record<string, string> = { S: "String", N: "Number", B: "Binary" };

export async function describeTable(exec: Exec, name: string): Promise<TableDescription> {
  const out = await exec<{ Table: TableDescription }>("dynamodb", "DescribeTable", { TableName: name });
  return out.Table;
}

export type StreamViewType = "KEYS_ONLY" | "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES";

export const STREAM_VIEW_TYPES: { value: StreamViewType; label: string; description: string }[] = [
  { value: "KEYS_ONLY", label: "Key attributes only", description: "Only the key attributes of the changed item." },
  { value: "NEW_IMAGE", label: "New image", description: "The entire item, as it appears after the change." },
  { value: "OLD_IMAGE", label: "Old image", description: "The entire item, as it appeared before the change." },
  { value: "NEW_AND_OLD_IMAGES", label: "New and old images", description: "Both the new and the old images of the item." },
];

export function streamViewTypeLabel(type: string | undefined): string {
  return STREAM_VIEW_TYPES.find((t) => t.value === type)?.label ?? type ?? "-";
}

export function streamEnabled(table: TableDescription): boolean {
  return !!table.StreamSpecification?.StreamEnabled;
}
