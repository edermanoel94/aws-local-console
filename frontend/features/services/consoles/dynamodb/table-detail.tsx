"use client";

import { useState } from "react";
import { Button, ConfirmDeleteDialog, EmptyState, ErrorAlert, Loading, Panel, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { useAwsLoader, useConsoleAction } from "../_shared/aws";
import { CopyableText } from "../_shared/controls";
import { formatBytes, formatDateTime } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { TagsPanel } from "../_shared/tags-panel";
import { describeTable, tableKeys, TYPE_LABELS, type TableDescription } from "./ddb-types";
import { ItemsExplorer } from "./items-explorer";
import { StatusBadge } from "./table-list";

type TableTab = "items" | "overview" | "indexes" | "tags";

const TABS: { value: TableTab; label: string }[] = [
  { value: "items", label: "Explore items" },
  { value: "overview", label: "Overview" },
  { value: "indexes", label: "Indexes" },
  { value: "tags", label: "Tags" },
];

export function TableDetail({ tableName }: { tableName: string }) {
  const { detail, navigate } = useConsoleNav();
  const tab: TableTab = TABS.some((t) => t.value === detail) ? (detail as TableTab) : "items";
  const table = useAwsLoader(["dynamodb", "table", tableName], (exec) => describeTable(exec, tableName));
  const [deleting, setDeleting] = useState(false);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("dynamodb", "DeleteTable", { TableName: tableName }),
    successMessage: () => `Table ${tableName} deleted`,
    onSuccess: () => navigate({}),
  });

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Tables", to: {} }, { label: tableName }]}
        title={tableName}
        badge={table.data && <StatusBadge status={table.data.TableStatus} />}
        actions={
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      {table.error ? (
        <ErrorAlert error={table.error} />
      ) : table.isLoading || !table.data ? (
        <Loading />
      ) : (
        <>
          <Tabs label="Table sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: tableName, detail: t })} />
          {tab === "items" && <ItemsExplorer table={table.data} />}
          {tab === "overview" && <Overview table={table.data} />}
          {tab === "indexes" && <Indexes table={table.data} />}
          {tab === "tags" && table.data.TableArn && (
            <TagsPanel
              queryKey={["dynamodb-table", tableName]}
              load={async (exec) => {
                const out = await exec<{ Tags?: { Key: string; Value: string }[] | null }>("dynamodb", "ListTagsOfResource", { ResourceArn: table.data.TableArn });
                return (out.Tags ?? []).map((t) => ({ key: t.Key, value: t.Value }));
              }}
              save={async (exec, rows, previous) => {
                const arn = table.data.TableArn;
                const removed = previous.filter((p) => !rows.some((r) => r.key.trim() === p.key)).map((p) => p.key);
                if (removed.length) await exec("dynamodb", "UntagResource", { ResourceArn: arn, TagKeys: removed });
                if (rows.length) await exec("dynamodb", "TagResource", { ResourceArn: arn, Tags: rows.map((r) => ({ Key: r.key.trim(), Value: r.value })) });
              }}
              successMessage={`Tags of table ${tableName} saved`}
            />
          )}
        </>
      )}
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="table"
        resourceName={tableName}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

function Overview({ table }: { table: TableDescription }) {
  const keys = tableKeys(table);
  const onDemand = table.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST";
  return (
    <>
      <Panel title="General information">
        <DetailsGrid
          items={[
            { label: "Partition key", value: `${keys.partition.name} (${TYPE_LABELS[keys.partition.type] ?? keys.partition.type})` },
            { label: "Sort key", value: keys.sort ? `${keys.sort.name} (${TYPE_LABELS[keys.sort.type] ?? keys.sort.type})` : "-" },
            { label: "Capacity mode", value: onDemand ? "On-demand" : "Provisioned" },
            { label: "Table status", value: <StatusBadge status={table.TableStatus} /> },
            { label: "Creation date", value: formatDateTime(table.CreationDateTime) },
            { label: "Amazon Resource Name (ARN)", value: table.TableArn ? <CopyableText value={table.TableArn} label="Copy table ARN" /> : "-" },
          ]}
        />
      </Panel>
      <Panel title="Items summary" description="Item count and size are approximate and updated periodically by DynamoDB.">
        <DetailsGrid
          items={[
            { label: "Item count", value: String(table.ItemCount ?? 0) },
            { label: "Table size", value: formatBytes(table.TableSizeBytes ?? 0) },
            {
              label: "Read / write capacity",
              value: onDemand ? "On-demand" : `${table.ProvisionedThroughput?.ReadCapacityUnits ?? "-"} RCU / ${table.ProvisionedThroughput?.WriteCapacityUnits ?? "-"} WCU`,
            },
            { label: "DynamoDB stream", value: table.StreamSpecification?.StreamEnabled ? `On (${table.StreamSpecification.StreamViewType})` : "Off" },
          ]}
        />
      </Panel>
    </>
  );
}

function Indexes({ table }: { table: TableDescription }) {
  const indexes = [
    ...(table.GlobalSecondaryIndexes ?? []).map((i) => ({ ...i, kind: "Global" })),
    ...(table.LocalSecondaryIndexes ?? []).map((i) => ({ ...i, kind: "Local", IndexStatus: "ACTIVE" })),
  ];
  return (
    <Panel title="Secondary indexes" count={indexes.length} bodyClassName={indexes.length ? "px-0! py-0!" : undefined}>
      {indexes.length === 0 ? (
        <EmptyState title="No secondary indexes" description="Indexes let you query the table by alternate keys." />
      ) : (
        <Table aria-label="Secondary indexes" className="[&_tbody_tr:last-child_td]:border-b-0">
          <thead>
            <tr>
              <Th className="pl-5">Name</Th>
              <Th>Type</Th>
              <Th>Partition key</Th>
              <Th>Sort key</Th>
              <Th className="pr-5">Projection</Th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((i) => (
              <Tr key={i.IndexName}>
                <Td className="pl-5 font-bold">{i.IndexName}</Td>
                <Td>{i.kind}</Td>
                <Td>{i.KeySchema.find((k) => k.KeyType === "HASH")?.AttributeName ?? "-"}</Td>
                <Td>{i.KeySchema.find((k) => k.KeyType === "RANGE")?.AttributeName ?? "-"}</Td>
                <Td className="pr-5">{i.Projection?.ProjectionType ?? "-"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
