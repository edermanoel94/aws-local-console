"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import type { ListBucketsOutput, S3Bucket } from "./s3-types";

export function BucketList() {
  const { navigate } = useConsoleNav();
  const buckets = useAwsQuery<ListBucketsOutput>("s3", "ListBuckets");
  const items = buckets.data ? [...(buckets.data.Buckets ?? [])].sort((a, b) => a.Name.localeCompare(b.Name)) : undefined;

  return (
    <>
      <ResourceTable<S3Bucket>
        title="Buckets"
        items={items}
        loading={buckets.isLoading}
        fetching={buckets.isFetching}
        error={buckets.error}
        onRefresh={() => buckets.refetch()}
        actions={
          <Button variant="primary" onClick={() => navigate({ view: "create" })}>
            <Plus className="size-4" aria-hidden />
            Create bucket
          </Button>
        }
        rowKey={(b) => b.Name}
        filterText={(b) => b.Name}
        searchPlaceholder="Find buckets by name"
        emptyTitle="No buckets"
        emptyDescription="You don't have any buckets yet. Create a bucket to start storing objects."
        columns={[
          {
            header: "Name",
            cell: (b) => <ConsoleLink to={{ resource: b.Name }}>{b.Name}</ConsoleLink>,
          },
          { header: "Creation date", cell: (b) => formatDateTime(b.CreationDate), className: "whitespace-nowrap" },
        ]}
      />
    </>
  );
}
