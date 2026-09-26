"use client";

import { Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import type { RestApi } from "./apigw-types";

export function ApiList() {
  const { navigate } = useConsoleNav();
  const apis = useAwsQuery<{ Items?: RestApi[] | null }>("apigateway", "GetRestApis", { Limit: 500 });
  const items = apis.data ? [...(apis.data.Items ?? [])].sort((a, b) => a.Name.localeCompare(b.Name)) : undefined;

  return (
    <ResourceTable<RestApi>
      title="APIs"
      description="REST APIs (API Gateway v1). Deploy an API to a stage to invoke it."
      items={items}
      loading={apis.isLoading}
      fetching={apis.isFetching}
      error={apis.error}
      onRefresh={() => apis.refetch()}
      actions={
        <Button variant="primary" onClick={() => navigate({ view: "create" })}>
          <Plus className="size-4" aria-hidden />
          Create API
        </Button>
      }
      rowKey={(a) => a.Id}
      filterText={(a) => `${a.Name} ${a.Id} ${a.Description ?? ""}`}
      searchPlaceholder="Find APIs"
      emptyTitle="No APIs"
      emptyDescription="You don't have any REST APIs yet. Create an API to route HTTP requests to Lambda functions or mock responses."
      columns={[
        { header: "Name", cell: (a) => <ConsoleLink to={{ resource: a.Id }}>{a.Name}</ConsoleLink> },
        { header: "ID", cell: (a) => <span className="font-mono text-xs">{a.Id}</span> },
        { header: "Description", cell: (a) => <span className="text-aws-muted">{a.Description || "-"}</span> },
        { header: "Protocol", cell: () => <Badge>REST</Badge> },
        { header: "Endpoint type", cell: (a) => a.EndpointConfiguration?.Types?.join(", ") || "EDGE" },
        { header: "Created", cell: (a) => formatDateTime(a.CreatedDate), className: "whitespace-nowrap" },
      ]}
    />
  );
}
