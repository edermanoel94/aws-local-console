"use client";

import { useState } from "react";
import { Folder, FileText, FolderPlus, Upload } from "lucide-react";
import { Button, Dialog, ErrorAlert, TextField } from "@/components/ui";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { formatBytes, formatDateTime } from "../_shared/format";
import { ConsoleLink } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import type { ListObjectsV2Output } from "./s3-types";

interface Row {
  key: string;
  folder: boolean;
  size?: number;
  lastModified?: string;
  storageClass?: string;
}

export function ObjectsTab({ bucket }: { bucket: string }) {
  const { prefix: rawPrefix, navigate } = useConsoleNav();
  const prefix = rawPrefix ?? "";
  const objects = useAwsQuery<ListObjectsV2Output>("s3", "ListObjectsV2", { Bucket: bucket, Prefix: prefix, Delimiter: "/" });
  const [folderOpen, setFolderOpen] = useState(false);

  const rows: Row[] | undefined = objects.data
    ? [
        ...(objects.data.CommonPrefixes ?? []).map((p) => ({ key: p.Prefix, folder: true })),
        ...(objects.data.Contents ?? []).filter((o) => o.Key !== prefix).map((o) => ({ key: o.Key, folder: false, size: o.Size, lastModified: o.LastModified, storageClass: o.StorageClass })),
      ]
    : undefined;

  const segments = prefix.split("/").filter(Boolean);

  return (
    <>
      <ResourceTable<Row>
        title="Objects"
        description={
          segments.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              <ConsoleLink to={{ resource: bucket }} className="font-normal">
                {bucket}
              </ConsoleLink>
              {segments.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span aria-hidden>/</span>
                  <ConsoleLink to={{ resource: bucket, prefix: `${segments.slice(0, i + 1).join("/")}/` }} className="font-normal">
                    {s}
                  </ConsoleLink>
                </span>
              ))}
            </span>
          ) : (
            "Objects are the fundamental entities stored in Amazon S3."
          )
        }
        items={rows}
        loading={objects.isLoading}
        fetching={objects.isFetching}
        error={objects.error}
        onRefresh={() => objects.refetch()}
        actions={
          <>
            <Button onClick={() => setFolderOpen(true)}>
              <FolderPlus className="size-4" aria-hidden />
              Create folder
            </Button>
            <Button variant="primary" onClick={() => navigate({ resource: bucket, view: "upload", prefix: prefix || null })}>
              <Upload className="size-4" aria-hidden />
              Upload
            </Button>
          </>
        }
        rowKey={(r) => r.key}
        filterText={(r) => r.key}
        searchPlaceholder="Find objects by prefix or name"
        emptyTitle="No objects"
        emptyDescription="You don't have any objects in this location. Upload a file or create a folder."
        columns={[
          {
            header: "Name",
            cell: (r) => (
              <span className="flex items-center gap-2">
                {r.folder ? <Folder className="size-4 shrink-0 text-aws-muted" aria-hidden /> : <FileText className="size-4 shrink-0 text-aws-muted" aria-hidden />}
                <ConsoleLink to={r.folder ? { resource: bucket, prefix: r.key } : { resource: bucket, item: r.key }} className="break-all">
                  {r.key.slice(prefix.length)}
                </ConsoleLink>
              </span>
            ),
          },
          { header: "Type", cell: (r) => (r.folder ? "Folder" : (r.key.split(".").length > 1 ? r.key.split(".").pop() : "-")) },
          { header: "Last modified", cell: (r) => (r.folder ? "-" : formatDateTime(r.lastModified)), className: "whitespace-nowrap" },
          { header: "Size", cell: (r) => (r.folder ? "-" : formatBytes(r.size)), className: "whitespace-nowrap" },
          { header: "Storage class", cell: (r) => (r.folder ? "-" : (r.storageClass ?? "Standard")) },
        ]}
      />
      {folderOpen && <CreateFolderDialog bucket={bucket} prefix={prefix} onClose={() => setFolderOpen(false)} />}
    </>
  );
}

function CreateFolderDialog({ bucket, prefix, onClose }: { bucket: string; prefix: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const invalid = name.includes("/") ? "Folder names can't contain \"/\"." : undefined;
  const create = useConsoleAction({
    run: (_: void, exec) => exec("s3", "PutObject", { Bucket: bucket, Key: `${prefix}${name.trim()}/`, Body: "" }),
    successMessage: () => `Folder ${name.trim()} created`,
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create folder"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !!invalid} loading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Folder name" value={name} onChange={(e) => setName(e.target.value)} error={invalid} autoFocus placeholder="images" />
        {create.error && <ErrorAlert error={create.error} />}
      </div>
    </Dialog>
  );
}
