"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { formatBytes, formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import type { FunctionConfiguration } from "./lambda-types";
import { RUNTIMES } from "./runtimes";

export function runtimeLabel(runtime?: string) {
  return RUNTIMES.find((r) => r.value === runtime)?.label ?? runtime ?? "-";
}

export function FunctionList() {
  const { navigate } = useConsoleNav();
  const functions = useAwsQuery<{ Functions?: FunctionConfiguration[] | null }>("lambda", "ListFunctions");
  const items = functions.data ? [...(functions.data.Functions ?? [])].sort((a, b) => a.FunctionName.localeCompare(b.FunctionName)) : undefined;

  return (
    <ResourceTable<FunctionConfiguration>
      title="Functions"
      items={items}
      loading={functions.isLoading}
      fetching={functions.isFetching}
      error={functions.error}
      onRefresh={() => functions.refetch()}
      actions={
        <Button variant="primary" onClick={() => navigate({ view: "create" })}>
          <Plus className="size-4" aria-hidden />
          Create function
        </Button>
      }
      rowKey={(f) => f.FunctionArn}
      filterText={(f) => `${f.FunctionName} ${f.Description ?? ""}`}
      searchPlaceholder="Filter by function name or description"
      emptyTitle="No functions"
      emptyDescription="You don't have any functions yet. Create a function to run code without managing servers."
      columns={[
        { header: "Function name", cell: (f) => <ConsoleLink to={{ resource: f.FunctionName }}>{f.FunctionName}</ConsoleLink> },
        { header: "Description", cell: (f) => <span className="text-aws-muted">{f.Description || "-"}</span> },
        { header: "Package type", cell: (f) => f.PackageType ?? "Zip" },
        { header: "Runtime", cell: (f) => runtimeLabel(f.Runtime), className: "whitespace-nowrap" },
        { header: "Code size", cell: (f) => formatBytes(f.CodeSize), className: "whitespace-nowrap text-right" },
        { header: "Last modified", cell: (f) => formatDateTime(f.LastModified), className: "whitespace-nowrap" },
      ]}
    />
  );
}
