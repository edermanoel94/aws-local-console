"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Badge, Button, ConfirmDeleteDialog, Panel, TextField } from "@/components/ui";
import { useRegion } from "@/hooks/use-region";
import { ACCOUNT_ID, useConsoleAction } from "../_shared/aws";
import { CopyableText } from "../_shared/controls";
import { formatDateTime } from "../_shared/format";
import { ConsoleHeader, ConsoleLink, DetailsGrid, FormPage } from "../_shared/layout";
import { useConsoleNav } from "../_shared/nav";
import { ResourceTable } from "../_shared/resource-table";
import { DEFAULT_BUS, type EventBus } from "./events-types";
import { RulesTable, useEventBuses } from "./rule-list";

export function BusList() {
  const { navigate } = useConsoleNav();
  const buses = useEventBuses();
  const items = buses.data ? [...(buses.data.EventBuses ?? [])].sort((a, b) => (a.Name === DEFAULT_BUS ? -1 : b.Name === DEFAULT_BUS ? 1 : a.Name.localeCompare(b.Name))) : undefined;
  return (
    <ResourceTable<EventBus>
      title="Event buses"
      description="Event buses receive events from AWS services and applications. Every account has a default bus."
      items={items}
      loading={buses.isLoading}
      fetching={buses.isFetching}
      error={buses.error}
      onRefresh={() => buses.refetch()}
      actions={
        <Button variant="primary" onClick={() => navigate({ view: "create-bus" })}>
          <Plus className="size-4" aria-hidden />
          Create event bus
        </Button>
      }
      rowKey={(b) => b.Name}
      filterText={(b) => b.Name}
      searchPlaceholder="Find event buses"
      emptyTitle="No event buses"
      columns={[
        {
          header: "Name",
          cell: (b) => (
            <span className="flex items-center gap-2">
              <ConsoleLink to={{ view: "bus", resource: b.Name }}>{b.Name}</ConsoleLink>
              {b.Name === DEFAULT_BUS && <Badge>Default</Badge>}
            </span>
          ),
        },
        { header: "ARN", cell: (b) => <span className="font-mono text-xs break-all">{b.Arn ?? "-"}</span> },
        { header: "Description", cell: (b) => <span className="text-aws-muted">{b.Description || "-"}</span> },
        { header: "Created", cell: (b) => formatDateTime(b.CreationTime), className: "whitespace-nowrap" },
      ]}
    />
  );
}

export function BusDetail({ busName }: { busName: string }) {
  const { navigate } = useConsoleNav();
  const region = useRegion();
  const buses = useEventBuses();
  const bus = buses.data?.EventBuses?.find((b) => b.Name === busName);
  const [deleting, setDeleting] = useState(false);
  const remove = useConsoleAction({
    run: (_: void, exec) => exec("events", "DeleteEventBus", { Name: busName }),
    successMessage: () => `Event bus ${busName} deleted`,
    onSuccess: () => navigate({ view: "buses" }),
  });
  const arn = bus?.Arn ?? `arn:aws:events:${region}:${ACCOUNT_ID}:event-bus/${busName}`;

  return (
    <>
      <ConsoleHeader
        crumbs={[{ label: "Event buses", to: { view: "buses" } }, { label: busName }]}
        title={busName}
        actions={
          busName !== DEFAULT_BUS && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )
        }
      />
      <Panel title="Event bus details">
        <DetailsGrid
          items={[
            { label: "Name", value: busName },
            { label: "ARN", value: <CopyableText value={arn} label="Copy event bus ARN" /> },
            { label: "Description", value: bus?.Description },
          ]}
        />
      </Panel>
      <RulesTable bus={busName} fixedBus />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        onConfirm={() => remove.mutate()}
        resourceKind="event bus"
        resourceName={busName}
        loading={remove.isPending}
        error={remove.error}
      />
    </>
  );
}

const busSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter an event bus name.")
    .max(256, "Event bus names can be up to 256 characters.")
    .regex(/^[A-Za-z0-9._-]+$/, "Event bus names can contain only letters, numbers, periods (.), hyphens (-) and underscores (_).")
    .refine((v) => v !== DEFAULT_BUS, 'The name "default" is reserved.'),
  description: z.string().max(512),
});

type BusValues = z.infer<typeof busSchema>;

export function CreateBusPage() {
  const { navigate } = useConsoleNav();
  const form = useForm<BusValues>({ resolver: zodResolver(busSchema), defaultValues: { name: "", description: "" } });
  const create = useConsoleAction<BusValues>({
    run: (v, exec) => exec("events", "CreateEventBus", { Name: v.name, ...(v.description ? { Description: v.description } : {}) }),
    successMessage: (v) => `Event bus ${v.name} created`,
    onSuccess: (_, v) => navigate({ view: "bus", resource: v.name }),
  });
  const { errors } = form.formState;
  return (
    <FormPage
      crumbs={[{ label: "Event buses", to: { view: "buses" } }, { label: "Create event bus" }]}
      title="Create event bus"
      onSubmit={form.handleSubmit((v) => create.mutate(v))}
      onCancel={() => navigate({ view: "buses" })}
      submitting={create.isPending}
      error={create.error}
    >
      <Panel title="Event bus detail">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Event bus name" placeholder="orders-bus" autoFocus error={errors.name?.message} {...form.register("name")} />
          <TextField label="Description - optional" error={errors.description?.message} {...form.register("description")} />
        </div>
      </Panel>
    </FormPage>
  );
}
