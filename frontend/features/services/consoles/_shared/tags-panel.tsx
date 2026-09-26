"use client";

import { useState } from "react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { useAwsLoader, useConsoleAction, type Exec } from "./aws";
import { KeyValueEditor, type KeyValue } from "./controls";

/** Tags section with read view and "Manage tags" edit mode; load/save are service specific. */
export function TagsPanel({
  queryKey,
  load,
  save,
  title = "Tags",
  successMessage,
}: {
  queryKey: unknown[];
  load: (exec: Exec) => Promise<KeyValue[]>;
  save: (exec: Exec, next: KeyValue[], previous: KeyValue[]) => Promise<unknown>;
  title?: string;
  successMessage: string;
}) {
  const tags = useAwsLoader(["tags", ...queryKey], load);
  const [draft, setDraft] = useState<KeyValue[] | null>(null);
  const saveTags = useConsoleAction<KeyValue[]>({
    run: (rows, exec) => save(exec, rows.filter((r) => r.key.trim()), tags.data ?? []),
    successMessage: () => successMessage,
    onSuccess: () => setDraft(null),
  });

  return (
    <Panel
      title={title}
      count={tags.data?.length}
      bodyClassName={!draft && tags.data?.length ? "px-0! py-0!" : undefined}
      actions={
        draft ? null : (
          <Button onClick={() => setDraft(tags.data ?? [])} disabled={!tags.data}>
            Manage tags
          </Button>
        )
      }
    >
      {tags.error ? (
        <ErrorAlert error={tags.error} />
      ) : tags.isLoading ? (
        <Loading />
      ) : draft ? (
        <div className="flex flex-col gap-4">
          <KeyValueEditor rows={draft} onChange={setDraft} keyLabel="Tag key" valueLabel="Tag value" addLabel="Add new tag" />
          {saveTags.error && <ErrorAlert error={saveTags.error} />}
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setDraft(null);
                saveTags.reset();
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={saveTags.isPending} onClick={() => saveTags.mutate(draft)}>
              Save
            </Button>
          </div>
        </div>
      ) : !tags.data?.length ? (
        <EmptyState title="No tags" description="Tags are key-value pairs that help you organize and find resources." />
      ) : (
        <Table aria-label={title} className="[&_tbody_tr:last-child_td]:border-b-0">
          <thead>
            <tr>
              <Th className="w-1/3 pl-5">Key</Th>
              <Th className="pr-5">Value</Th>
            </tr>
          </thead>
          <tbody>
            {tags.data.map((t) => (
              <Tr key={t.key}>
                <Td className="pl-5 font-mono text-xs">{t.key}</Td>
                <Td className="pr-5 font-mono text-xs">{t.value || "-"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
