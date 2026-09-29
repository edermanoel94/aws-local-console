"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, CodeBlock, ConfirmDeleteDialog, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { toDisplayError } from "@/lib/errors";
import { toast } from "@/stores/toast";
import { makeExec, useAwsQuery, useConsoleAction } from "../_shared/aws";
import { CopyableText } from "../_shared/controls";
import { formatBytes, formatDateTime, prettyJson } from "../_shared/format";
import { ConsoleHeader, DetailsGrid } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { TagsPanel } from "../_shared/tags-panel";
import type { GetObjectOutput, HeadObjectOutput } from "./s3-types";
import { baseName, bodyToBlob, saveBlob } from "./s3-utils";

const PREVIEW_LIMIT = 512 * 1024;

export function ObjectDetail({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  const { navigate } = useConsoleNav();
  const region = useRegion();
  const folder = objectKey.includes("/") ? objectKey.slice(0, objectKey.lastIndexOf("/") + 1) : "";
  const back = () => navigate({ resource: bucket, prefix: folder || null });
  const head = useAwsQuery<HeadObjectOutput>("s3", "HeadObject", { Bucket: bucket, Key: objectKey });
  const size = head.data?.ContentLength ?? 0;
  const previewable = !!head.data && size <= PREVIEW_LIMIT;
  const content = useAwsQuery<GetObjectOutput>("s3", "GetObject", { Bucket: bucket, Key: objectKey }, { enabled: previewable });
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("s3", "DeleteObject", { Bucket: bucket, Key: objectKey }),
    successMessage: () => `Object ${objectKey} deleted`,
    onSuccess: back,
  });

  const download = async () => {
    setDownloading(true);
    try {
      const out = await makeExec(region)<GetObjectOutput>("s3", "GetObject", { Bucket: bucket, Key: objectKey });
      saveBlob(bodyToBlob(out.Body, out.ContentType), baseName(objectKey));
      toast.success(`Object ${objectKey} downloaded`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(`${e.code}: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const meta = Object.entries(head.data?.Metadata ?? {});
  const body = content.data?.Body;

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Buckets", to: {} }, { label: bucket, to: { resource: bucket, prefix: folder || null } }, { label: baseName(objectKey) }]}
        title={baseName(objectKey)}
        actions={
          <>
            <Button onClick={download} loading={downloading}>
              <Download className="size-4" aria-hidden />
              Download
            </Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </>
        }
      />
      <Panel title="Object overview">
        {head.error ? (
          <ErrorAlert error={head.error} />
        ) : head.isLoading || !head.data ? (
          <Loading />
        ) : (
          <DetailsGrid
            items={[
              { label: "Key", value: objectKey, mono: true },
              { label: "Size", value: `${formatBytes(size)} (${size} bytes)` },
              { label: "Type", value: head.data.ContentType },
              { label: "Last modified", value: formatDateTime(head.data.LastModified) },
              { label: "Entity tag (ETag)", value: head.data.ETag?.replaceAll('"', ""), mono: true },
              { label: "Version ID", value: head.data.VersionId ?? "null", mono: true },
              { label: "Storage class", value: head.data.StorageClass ?? "Standard" },
              { label: "S3 URI", value: <CopyableText value={`s3://${bucket}/${objectKey}`} label="Copy S3 URI" /> },
              { label: "Amazon Resource Name (ARN)", value: <CopyableText value={`arn:aws:s3:::${bucket}/${objectKey}`} label="Copy ARN" /> },
            ]}
          />
        )}
      </Panel>
      <Panel title="Metadata" count={head.data ? meta.length + 1 : undefined} description="System and user-defined metadata returned by HeadObject." bodyClassName="px-0! py-0!">
        {head.data ? (
          <Table aria-label="Metadata" className="[&_tbody_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                <Th className="pl-5">Type</Th>
                <Th>Key</Th>
                <Th className="pr-5">Value</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td className="pl-5">System defined</Td>
                <Td className="font-mono text-xs">Content-Type</Td>
                <Td className="pr-5 font-mono text-xs">{head.data.ContentType ?? "-"}</Td>
              </Tr>
              {meta.map(([k, v]) => (
                <Tr key={k}>
                  <Td className="pl-5">User defined</Td>
                  <Td className="font-mono text-xs">x-amz-meta-{k}</Td>
                  <Td className="pr-5 font-mono text-xs">{v}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Loading className="px-5" />
        )}
      </Panel>
      <Panel title="Content preview">
        {!head.data ? (
          <Loading />
        ) : !previewable ? (
          <EmptyState title="No preview available" description={`Objects larger than ${formatBytes(PREVIEW_LIMIT)} can't be previewed. Download the object to view it.`} />
        ) : content.error ? (
          <ErrorAlert error={content.error} />
        ) : content.isLoading ? (
          <Loading />
        ) : typeof body === "string" ? (
          body.length === 0 ? (
            <EmptyState title="No content" description="This object is empty." />
          ) : (
            <CodeBlock text={prettyJson(body)} label="Object content" className="max-h-[420px] whitespace-pre-wrap" />
          )
        ) : (
          <EmptyState title="No text preview" description="This object contains binary data. Download the object to view it." />
        )}
      </Panel>
      <TagsPanel
        queryKey={["s3-object", bucket, objectKey]}
        load={async (exec) => {
          const out = await exec<{ TagSet?: { Key: string; Value: string }[] }>("s3", "GetObjectTagging", { Bucket: bucket, Key: objectKey });
          return (out.TagSet ?? []).map((t) => ({ key: t.Key, value: t.Value }));
        }}
        save={(exec, rows) =>
          rows.length
            ? exec("s3", "PutObjectTagging", { Bucket: bucket, Key: objectKey, Tagging: { TagSet: rows.map((r) => ({ Key: r.key.trim(), Value: r.value })) } })
            : exec("s3", "DeleteObjectTagging", { Bucket: bucket, Key: objectKey })
        }
        successMessage={`Tags of ${objectKey} saved`}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="object"
        resourceName={objectKey}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}
