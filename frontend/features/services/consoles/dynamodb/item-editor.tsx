"use client";

import { useState } from "react";
import { Button, Dialog, ErrorAlert, Loading } from "@/components/ui";
import { toast } from "@/stores/toast";
import { useAwsQuery, useConsoleAction } from "../_shared/aws";
import { CodeField, ConfirmDialog, SegmentedControl } from "../_shared/controls";
import { marshallItem, sameValue, unmarshallItem, validateDynamoItem, type DynamoItem } from "./ddb-json";
import { tableKeys, type TableDescription } from "./ddb-types";

type Format = "json" | "dynamodb";

function render(item: DynamoItem, format: Format) {
  return JSON.stringify(format === "json" ? unmarshallItem(item) : item, null, 2);
}

/** Parses the editor text in the given format into a DynamoDB item, or throws a user facing Error. */
function parse(text: string, format: Format): DynamoItem {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The item must be a JSON object.");
  if (format === "json") return marshallItem(value as Record<string, unknown>);
  const invalid = validateDynamoItem(value);
  if (invalid) throw new Error(invalid);
  return value as DynamoItem;
}

/** Create item (PutItem) or view/edit an existing item (GetItem, UpdateItem, DeleteItem). */
export function ItemEditor({ table, itemKey, onClose }: { table: TableDescription; itemKey?: DynamoItem; onClose: () => void }) {
  const current = useAwsQuery<{ Item?: DynamoItem | null }>("dynamodb", "GetItem", { TableName: table.TableName, Key: itemKey }, { enabled: !!itemKey, staleTime: Infinity });
  if (itemKey && current.isLoading) {
    return (
      <Dialog open onClose={onClose} title="Edit item" size="lg">
        <Loading />
      </Dialog>
    );
  }
  if (itemKey && (current.error || !current.data?.Item)) {
    return (
      <Dialog open onClose={onClose} title="Edit item" size="lg" footer={<Button onClick={onClose}>Close</Button>}>
        {current.error ? <ErrorAlert error={current.error} /> : <p className="text-sm">The item no longer exists.</p>}
      </Dialog>
    );
  }
  return <ItemForm table={table} original={itemKey ? (current.data?.Item ?? undefined) : undefined} onClose={onClose} />;
}

function ItemForm({ table, original, onClose }: { table: TableDescription; original?: DynamoItem; onClose: () => void }) {
  const keys = tableKeys(table);
  const keyNames = [keys.partition.name, ...(keys.sort ? [keys.sort.name] : [])];
  const template: DynamoItem = Object.fromEntries(keyNames.map((k, i) => [k, (i === 0 ? keys.partition.type : keys.sort?.type) === "N" ? { N: "0" } : { S: "" }]));
  const [format, setFormat] = useState<Format>("json");
  const [text, setText] = useState(() => render(original ?? template, "json"));
  const [parseError, setParseError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const originalKey = original ? Object.fromEntries(keyNames.map((k) => [k, original[k]])) : undefined;

  const create = useConsoleAction<DynamoItem>({
    run: (item, exec) =>
      exec("dynamodb", "PutItem", {
        TableName: table.TableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": keys.partition.name },
      }),
    successMessage: () => "Item created",
    onSuccess: onClose,
  });

  const update = useConsoleAction<DynamoItem>({
    run: (item, exec) => {
      const base = original ?? {};
      const set = Object.keys(item).filter((k) => !keyNames.includes(k) && !sameValue(item[k], base[k]));
      const remove = Object.keys(base).filter((k) => !keyNames.includes(k) && !(k in item));
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const parts: string[] = [];
      if (set.length) {
        parts.push(
          "SET " +
            set
              .map((k, i) => {
                names[`#s${i}`] = k;
                values[`:s${i}`] = item[k];
                return `#s${i} = :s${i}`;
              })
              .join(", "),
        );
      }
      if (remove.length) {
        parts.push(
          "REMOVE " +
            remove
              .map((k, i) => {
                names[`#r${i}`] = k;
                return `#r${i}`;
              })
              .join(", "),
        );
      }
      return exec("dynamodb", "UpdateItem", {
        TableName: table.TableName,
        Key: originalKey,
        UpdateExpression: parts.join(" "),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ReturnValues: "ALL_NEW",
      });
    },
    successMessage: () => "Item saved",
    onSuccess: onClose,
  });

  const remove = useConsoleAction({
    run: (_: void, exec) => exec("dynamodb", "DeleteItem", { TableName: table.TableName, Key: originalKey }),
    successMessage: () => "Item deleted",
    onSuccess: onClose,
  });

  const switchFormat = (next: Format) => {
    if (next === format) return;
    try {
      setText(render(parse(text, format), next));
      setFormat(next);
      setParseError(undefined);
    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  const submit = () => {
    let item: DynamoItem;
    try {
      item = parse(text, format);
    } catch (err) {
      setParseError((err as Error).message);
      return;
    }
    for (const k of keyNames) {
      if (!item[k]) {
        setParseError(`The item must contain the key attribute "${k}".`);
        return;
      }
    }
    if (originalKey && keyNames.some((k) => !sameValue(item[k], originalKey[k]))) {
      setParseError("Key attributes can't be changed. Create a new item instead.");
      return;
    }
    setParseError(undefined);
    if (!original) {
      create.mutate(item);
      return;
    }
    const changed = Object.keys(item).some((k) => !sameValue(item[k], original[k])) || Object.keys(original).some((k) => !(k in item));
    if (!changed) {
      toast.info("No changes to save");
      onClose();
      return;
    }
    update.mutate(item);
  };

  const mutation = original ? update : create;
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={original ? "Edit item" : "Create item"}
        size="lg"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {original && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete item
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" loading={mutation.isPending} onClick={submit}>
                {original ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-aws-muted">
              {original ? "Item retrieved with GetItem. Saving applies an UpdateItem with the changed attributes." : `Key attributes: ${keyNames.join(", ")}.`}
            </p>
            <SegmentedControl
              legend="Attribute format"
              name="item-format"
              value={format}
              onChange={switchFormat}
              hideLegend
              options={[
                { value: "json", label: "JSON" },
                { value: "dynamodb", label: "DynamoDB JSON" },
              ]}
            />
          </div>
          <CodeField label="Item" value={text} onChange={setText} rows={14} error={parseError} />
          {mutation.error && <ErrorAlert error={mutation.error} />}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        title="Delete item"
        confirmLabel="Confirm delete"
        loading={remove.isPending}
        error={remove.error}
      >
        <p>Permanently delete this item? This action cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}
