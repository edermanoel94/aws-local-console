"use client";

import { Badge } from "@/components/ui";
import { useAwsQuery } from "../_shared/aws";
import { formatBytes, formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { ResourceTable } from "../_shared/resource-table";
import type { ListObjectVersionsOutput } from "./s3-types";

interface VersionRow {
  key: string;
  versionId: string;
  latest: boolean;
  deleteMarker: boolean;
  size?: number;
  lastModified?: string;
}

export function VersionsTab({ bucket }: { bucket: string }) {
  const versions = useAwsQuery<ListObjectVersionsOutput>("s3", "ListObjectVersions", { Bucket: bucket });
  const rows: VersionRow[] | undefined = versions.data
    ? [
        ...(versions.data.Versions ?? []).map((v) => ({ key: v.Key, versionId: v.VersionId ?? "null", latest: !!v.IsLatest, deleteMarker: false, size: v.Size, lastModified: v.LastModified })),
        ...(versions.data.DeleteMarkers ?? []).map((v) => ({ key: v.Key, versionId: v.VersionId ?? "null", latest: !!v.IsLatest, deleteMarker: true, lastModified: v.LastModified })),
      ].sort((a, b) => a.key.localeCompare(b.key) || String(b.lastModified).localeCompare(String(a.lastModified)))
    : undefined;

  return (
    <ResourceTable<VersionRow>
      title="Object versions"
      description="Every version of every object, including delete markers. Enable Bucket Versioning in Properties to keep previous versions."
      label="Object versions"
      items={rows}
      loading={versions.isLoading}
      fetching={versions.isFetching}
      error={versions.error}
      onRefresh={() => versions.refetch()}
      rowKey={(r) => `${r.key}#${r.versionId}`}
      filterText={(r) => `${r.key} ${r.versionId}`}
      searchPlaceholder="Find versions by key or version ID"
      emptyTitle="No object versions"
      columns={[
        {
          header: "Key",
          cell: (r) =>
            r.deleteMarker ? (
              <span className="break-all">{r.key}</span>
            ) : (
              <ConsoleLink to={{ resource: bucket, item: r.key }} className="break-all">
                {r.key}
              </ConsoleLink>
            ),
        },
        { header: "Version ID", cell: (r) => <span className="font-mono text-xs break-all">{r.versionId}</span> },
        {
          header: "Type",
          cell: (r) => (
            <span className="flex flex-wrap gap-1">
              {r.deleteMarker ? <Badge tone="orange">Delete marker</Badge> : <Badge>Version</Badge>}
              {r.latest && <Badge tone="green">Latest</Badge>}
            </span>
          ),
        },
        { header: "Last modified", cell: (r) => formatDateTime(r.lastModified), className: "whitespace-nowrap" },
        { header: "Size", cell: (r) => (r.deleteMarker ? "-" : formatBytes(r.size)), className: "whitespace-nowrap" },
      ]}
    />
  );
}
