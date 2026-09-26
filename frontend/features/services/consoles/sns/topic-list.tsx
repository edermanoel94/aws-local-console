"use client";

import { Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { nameFromArn, useAwsLoader } from "../_shared/aws";
import { listAllPages } from "../_shared/paginate";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";

interface TopicRow {
  arn: string;
  name: string;
}

export function TopicList() {
  const { navigate } = useConsoleNav();
  const topics = useAwsLoader(["sns", "topics"], async (exec) => {
    const list = await listAllPages<{ Topics?: { TopicArn: string }[] | null; NextToken?: string | null }, { TopicArn: string }>(exec, "sns", "ListTopics", {}, {
      items: (out) => out.Topics,
      next: (out) => out.NextToken,
      tokenField: "NextToken",
    });
    return list.map((t) => ({ arn: t.TopicArn, name: nameFromArn(t.TopicArn) })).sort((a, b) => a.name.localeCompare(b.name));
  });
  const items = topics.data;

  return (
    <>
      <ResourceTable<TopicRow>
        title="Topics"
        items={items}
        loading={topics.isLoading}
        fetching={topics.isFetching}
        error={topics.error}
        onRefresh={() => topics.refetch()}
        actions={
          <Button variant="primary" onClick={() => navigate({ view: "create" })}>
            <Plus className="size-4" aria-hidden />
            Create topic
          </Button>
        }
        rowKey={(t) => t.arn}
        filterText={(t) => t.arn}
        searchPlaceholder="Search topics"
        emptyTitle="No topics"
        emptyDescription="You don't have any topics yet. Create a topic to start publishing messages."
        columns={[
          { header: "Name", cell: (t) => <ConsoleLink to={{ resource: t.name }}>{t.name}</ConsoleLink> },
          { header: "Type", cell: (t) => (t.name.endsWith(".fifo") ? <Badge tone="blue">FIFO</Badge> : <Badge>Standard</Badge>) },
          { header: "ARN", cell: (t) => <span className="font-mono text-xs break-all">{t.arn}</span> },
        ]}
      />
    </>
  );
}
