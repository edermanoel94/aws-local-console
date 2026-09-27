"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button, ConfirmDeleteDialog, Dialog, EmptyState, ErrorAlert, Panel, Table, Td, TextField, Th, Tr } from "@/components/ui";
import { useConsoleAction } from "../_shared/aws";
import { requiredInt } from "../_shared/validation";
import { describeKey, indexKeys, PROJECTION_LABELS, secondaryIndexes, tableKeys, type SecondaryIndex, type TableDescription } from "./ddb-types";
import { buildIndex, EMPTY_INDEX, IndexFields, indexSchema, MAX_GSI, validateIndex } from "./index-form";
import { StatusBadge } from "./table-list";

function projectionText(index: SecondaryIndex): string {
  const type = index.Projection?.ProjectionType;
  if (!type) return "-";
  const label = PROJECTION_LABELS[type] ?? type;
  return type === "INCLUDE" && index.Projection?.NonKeyAttributes?.length ? `${label} (${index.Projection.NonKeyAttributes.join(", ")})` : label;
}

export function IndexesTab({ table }: { table: TableDescription }) {
  const indexes = secondaryIndexes(table);
  const globalCount = indexes.filter((i) => i.kind === "GSI").length;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = useConsoleAction<string>({
    run: (name, exec) => exec("dynamodb", "UpdateTable", { TableName: table.TableName, GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: name } }] }),
    successMessage: (name) => `Index ${name} deleted`,
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <Panel
        title="Secondary indexes"
        count={indexes.length}
        description="Global indexes can be created and deleted at any time. Local indexes are defined when the table is created."
        bodyClassName={indexes.length ? "px-0! py-0!" : undefined}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} disabled={globalCount >= MAX_GSI}>
            <Plus className="size-4" aria-hidden />
            Create index
          </Button>
        }
      >
        {indexes.length === 0 ? (
          <EmptyState title="No secondary indexes" description="Indexes let you query the table by alternate keys. Choose Create index to add a global secondary index." />
        ) : (
          <Table aria-label="Secondary indexes" className="[&_tbody_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                <Th className="pl-5">Name</Th>
                <Th>Status</Th>
                <Th>Type</Th>
                <Th>Partition key</Th>
                <Th>Sort key</Th>
                <Th>Projection</Th>
                <Th className="pr-5">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((i) => {
                const keys = indexKeys(table, i.IndexName);
                return (
                  <Tr key={i.IndexName}>
                    <Td className="pl-5 font-bold break-all">{i.IndexName}</Td>
                    <Td>
                      <StatusBadge status={i.IndexStatus} />
                    </Td>
                    <Td>{i.kind === "GSI" ? "Global" : "Local"}</Td>
                    <Td>{describeKey(keys.partition)}</Td>
                    <Td>{keys.sort ? describeKey(keys.sort) : "-"}</Td>
                    <Td>{projectionText(i)}</Td>
                    <Td className="py-1 pr-5 text-right">
                      {i.kind === "GSI" && (
                        <Button size="sm" variant="danger" aria-label={`Delete index ${i.IndexName}`} onClick={() => setDeleting(i.IndexName)}>
                          Delete
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      {creating && <CreateIndexDialog table={table} onClose={() => setCreating(false)} />}
      <ConfirmDeleteDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        onConfirm={() => deleting && remove.mutate(deleting)}
        resourceKind="index"
        resourceName={deleting ?? ""}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

/** Adds a global secondary index to an existing table (UpdateTable). */
function CreateIndexDialog({ table, onClose }: { table: TableDescription; onClose: () => void }) {
  const keys = tableKeys(table);
  const provisioned = table.BillingModeSummary?.BillingMode !== "PAY_PER_REQUEST";
  const schema = useMemo(
    () =>
      z
        .object({
          index: indexSchema,
          readCapacity: provisioned ? requiredInt(1, 40000, "Read capacity units") : z.string(),
          writeCapacity: provisioned ? requiredInt(1, 40000, "Write capacity units") : z.string(),
        })
        .superRefine((v, ctx) => {
          const context = {
            attributeTypes: new Map<string, string>((table.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType])),
            takenNames: new Set(secondaryIndexes(table).map((i) => i.IndexName)),
          };
          validateIndex(v.index, tableKeys(table), context, (field, message) => ctx.addIssue({ code: "custom", path: ["index", field], message }));
        }),
    [table, provisioned],
  );
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      index: { ...EMPTY_INDEX },
      readCapacity: String(table.ProvisionedThroughput?.ReadCapacityUnits || 5),
      writeCapacity: String(table.ProvisionedThroughput?.WriteCapacityUnits || 5),
    },
  });

  const create = useConsoleAction<FormValues>({
    run: (v, exec) => {
      const { attributes, index } = buildIndex(v.index, keys);
      return exec("dynamodb", "UpdateTable", {
        TableName: table.TableName,
        AttributeDefinitions: attributes,
        GlobalSecondaryIndexUpdates: [
          {
            Create: {
              ...index,
              ...(provisioned ? { ProvisionedThroughput: { ReadCapacityUnits: Number(v.readCapacity), WriteCapacityUnits: Number(v.writeCapacity) } } : {}),
            },
          },
        ],
      });
    },
    successMessage: (v) => `Index ${v.index.name} created`,
    onSuccess: onClose,
  });

  const { errors } = form.formState;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create global secondary index"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
            Create index
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit((v) => create.mutate(v))} className="flex flex-col gap-4">
        <p className="text-sm text-aws-muted">DynamoDB builds the index from the existing items. Items without the index partition key are not added to it.</p>
        <IndexFields form={form} name="index" table={keys} allowLocal={false} />
        {provisioned && (
          <div className="grid items-start gap-4 md:grid-cols-2">
            <TextField label="Read capacity units" inputMode="numeric" error={errors.readCapacity?.message} {...form.register("readCapacity")} />
            <TextField label="Write capacity units" inputMode="numeric" error={errors.writeCapacity?.message} {...form.register("writeCapacity")} />
          </div>
        )}
        {create.error && <ErrorAlert error={create.error} />}
        {/* Enter in a field submits the form; the visible button lives in the dialog footer. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
