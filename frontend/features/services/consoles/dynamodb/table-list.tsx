"use client";

import { Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useAwsLoader } from "../_shared/aws";
import { formatBytes } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import { describeTable, tableKeys, TYPE_LABELS, type TableDescription } from "./ddb-types";

export function StatusBadge({ status }: { status?: string }) {
  return <Badge tone={status === "ACTIVE" ? "green" : status === "DELETING" ? "red" : "orange"}>{status ? status[0] + status.slice(1).toLowerCase() : "-"}</Badge>;
}

export function TableList() {
  const { navigate } = useConsoleNav();
  const tables = useAwsLoader(["dynamodb", "tables"], async (exec) => {
    const out = await exec<{ TableNames?: string[] | null }>("dynamodb", "ListTables", {});
    const names = out.TableNames ?? [];
    const described = await Promise.all(names.map((n) => describeTable(exec, n).catch(() => ({ TableName: n }) as TableDescription)));
    return described.sort((a, b) => a.TableName.localeCompare(b.TableName));
  });

  return (
    <>
      <ResourceTable<TableDescription>
        title="Tables"
        items={tables.data}
        loading={tables.isLoading}
        fetching={tables.isFetching}
        error={tables.error}
        onRefresh={() => tables.refetch()}
        actions={
          <Button variant="primary" onClick={() => navigate({ view: "create" })}>
            <Plus className="size-4" aria-hidden />
            Create table
          </Button>
        }
        rowKey={(t) => t.TableName}
        filterText={(t) => t.TableName}
        searchPlaceholder="Find tables by table name"
        emptyTitle="No tables"
        emptyDescription="You don't have any tables yet. Create a table to start storing items."
        columns={[
          { header: "Name", cell: (t) => <ConsoleLink to={{ resource: t.TableName }}>{t.TableName}</ConsoleLink> },
          { header: "Status", cell: (t) => <StatusBadge status={t.TableStatus} /> },
          {
            header: "Partition key",
            cell: (t) => {
              const k = tableKeys(t).partition;
              return k.name ? `${k.name} (${TYPE_LABELS[k.type] ?? k.type})` : "-";
            },
          },
          {
            header: "Sort key",
            cell: (t) => {
              const k = tableKeys(t).sort;
              return k ? `${k.name} (${TYPE_LABELS[k.type] ?? k.type})` : "-";
            },
          },
          { header: "Items", cell: (t) => t.ItemCount ?? "-", className: "text-right" },
          { header: "Size", cell: (t) => formatBytes(t.TableSizeBytes), className: "whitespace-nowrap text-right" },
          { header: "Capacity mode", cell: (t) => (t.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST" ? "On-demand" : "Provisioned") },
        ]}
      />
    </>
  );
}
