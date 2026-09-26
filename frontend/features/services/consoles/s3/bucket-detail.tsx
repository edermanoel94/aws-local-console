"use client";

import { useState } from "react";
import { Button, ConfirmDeleteDialog, Tabs } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { ConfirmDialog } from "../_shared/controls";
import { ConsoleHeader } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ObjectsTab } from "./objects-tab";
import { ObjectDetail } from "./object-detail";
import { UploadPage } from "./upload-page";
import { VersionsTab } from "./versions-tab";
import { PropertiesTab } from "./properties-tab";
import { emptyBucket } from "./s3-utils";

type BucketTab = "objects" | "versions" | "properties";

const TABS: { value: BucketTab; label: string }[] = [
  { value: "objects", label: "Objects" },
  { value: "versions", label: "Versions" },
  { value: "properties", label: "Properties" },
];

export function BucketDetail({ bucket }: { bucket: string }) {
  const { view, item, detail, navigate } = useConsoleNav();
  const tab: BucketTab = TABS.some((t) => t.value === detail) ? (detail as BucketTab) : "objects";
  const [dialog, setDialog] = useState<"delete" | "empty" | null>(null);

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("s3", "DeleteBucket", { Bucket: bucket }),
    successMessage: () => `Bucket ${bucket} deleted`,
    onSuccess: () => navigate({}),
  });
  const empty = useConsoleAction({
    run: (_: void, exec) => emptyBucket(exec, bucket),
    successMessage: (_, count) => `Bucket ${bucket} emptied (${count} object versions deleted)`,
    onSuccess: () => setDialog(null),
  });

  if (view === "upload") return <UploadPage bucket={bucket} />;
  if (item) return <ObjectDetail key={item} bucket={bucket} objectKey={item} />;

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Buckets", to: {} }, { label: bucket }]}
        title={bucket}
        actions={
          <>
            <Button onClick={() => setDialog("empty")}>Empty</Button>
            <Button variant="danger" onClick={() => setDialog("delete")}>
              Delete
            </Button>
          </>
        }
      />
      <Tabs label="Bucket sections" tabs={TABS} value={tab} onChange={(t) => navigate({ resource: bucket, detail: t })} />
      {tab === "objects" && <ObjectsTab bucket={bucket} />}
      {tab === "versions" && <VersionsTab bucket={bucket} />}
      {tab === "properties" && <PropertiesTab bucket={bucket} />}

      <ConfirmDeleteDialog
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="bucket"
        resourceName={bucket}
        loading={remove.isPending}
        error={remove.error}
      />
      <ConfirmDialog
        open={dialog === "empty"}
        onClose={() => {
          setDialog(null);
          empty.reset();
        }}
        onConfirm={() => empty.mutate()}
        title="Empty bucket"
        confirmLabel="Empty"
        confirmText="permanently delete"
        loading={empty.isPending}
        error={empty.error}
      >
        <p>
          Emptying <strong className="break-all">{bucket}</strong> deletes all objects, object versions and delete markers. This action cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
