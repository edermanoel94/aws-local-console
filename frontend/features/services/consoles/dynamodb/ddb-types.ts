import type { Exec } from "../_shared/aws";

export interface KeySchemaElement {
  AttributeName: string;
  KeyType: "HASH" | "RANGE";
}

export interface AttributeDefinition {
  AttributeName: string;
  AttributeType: "S" | "N" | "B";
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
  GlobalSecondaryIndexes?: { IndexName: string; KeySchema: KeySchemaElement[]; IndexStatus?: string; Projection?: { ProjectionType?: string } }[] | null;
  LocalSecondaryIndexes?: { IndexName: string; KeySchema: KeySchemaElement[]; Projection?: { ProjectionType?: string } }[] | null;
  StreamSpecification?: { StreamEnabled?: boolean; StreamViewType?: string } | null;
  LatestStreamArn?: string | null;
}

export interface TableKeys {
  partition: { name: string; type: string };
  sort?: { name: string; type: string };
}

export function tableKeys(table: TableDescription): TableKeys {
  const typeOf = (name: string) => table.AttributeDefinitions?.find((a) => a.AttributeName === name)?.AttributeType ?? "S";
  const hash = table.KeySchema?.find((k) => k.KeyType === "HASH")?.AttributeName ?? "";
  const range = table.KeySchema?.find((k) => k.KeyType === "RANGE")?.AttributeName;
  return { partition: { name: hash, type: typeOf(hash) }, sort: range ? { name: range, type: typeOf(range) } : undefined };
}

export const TYPE_LABELS: Record<string, string> = { S: "String", N: "Number", B: "Binary" };

export async function describeTable(exec: Exec, name: string): Promise<TableDescription> {
  const out = await exec<{ Table: TableDescription }>("dynamodb", "DescribeTable", { TableName: name });
  return out.Table;
}
