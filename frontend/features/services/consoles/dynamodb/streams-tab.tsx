"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAwsLoader, useConsoleAction, type Exec } from "../_shared/aws";
import { ConfirmDialog, CopyableText, RadioCards, SegmentedControl } from "../_shared/controls";
import { formatBytes, formatDateTime, plural } from "../_shared/format";
import { LambdaTriggers } from "../_shared/lambda-triggers";
import { DetailsGrid } from "../_shared/layout";
import { displayValue, unmarshallItem, type DynamoItem } from "./ddb-json";
import { describeTable, STREAM_VIEW_TYPES, streamEnabled, streamViewTypeLabel, type StreamViewType, type TableDescription } from "./ddb-types";

type EventName = "INSERT" | "MODIFY" | "REMOVE";

interface StreamRecord {
  EventID?: string;
  EventName?: EventName;
  Dynamodb?: {
    ApproximateCreationDateTime?: string;
    Keys?: DynamoItem;
    NewImage?: DynamoItem;
    OldImage?: DynamoItem;
    SequenceNumber?: string;
    SizeBytes?: number;
  };
}

interface Shard {
  ShardId: string;
  ParentShardId?: string;
  SequenceNumberRange?: { StartingSequenceNumber?: string; EndingSequenceNumber?: string };
}

interface StreamDescription {
  StreamArn: string;
  StreamStatus?: string;
  StreamViewType?: StreamViewType;
  CreationRequestDateTime?: string;
  Shards?: Shard[] | null;
  LastEvaluatedShardId?: string | null;
}

interface StreamContents {
  streamArn: string;
  enabled: boolean;
  description: StreamDescription;
  records: StreamRecord[];
  /** More records exist than were read (MAX_RECORDS). */
  truncated: boolean;
}

/** Upper bound of records read per refresh, so a busy stream can't freeze the page. */
const MAX_RECORDS = 1000;
/** GetRecords calls per shard; an open shard keeps returning a next iterator even when it is drained. */
const MAX_PAGES_PER_SHARD = 50;

const EVENT_TONES: Record<EventName, "green" | "blue" | "red"> = { INSERT: "green", MODIFY: "blue", REMOVE: "red" };

function compareSequence(a: StreamRecord, b: StreamRecord): number {
  const x = BigInt(a.Dynamodb?.SequenceNumber ?? "0");
  const y = BigInt(b.Dynamodb?.SequenceNumber ?? "0");
  return x === y ? 0 : x < y ? -1 : 1;
}

async function describeStream(exec: Exec, streamArn: string): Promise<StreamDescription> {
  let description: StreamDescription | undefined;
  const shards: Shard[] = [];
  let start: string | undefined;
  do {
    const out = await exec<{ StreamDescription: StreamDescription }>("dynamodbstreams", "DescribeStream", { StreamArn: streamArn, ...(start ? { ExclusiveStartShardId: start } : {}) });
    description ??= out.StreamDescription;
    shards.push(...(out.StreamDescription.Shards ?? []));
    start = out.StreamDescription.LastEvaluatedShardId ?? undefined;
  } while (start);
  return { ...description!, Shards: shards };
}

/**
 * Reads every retained record of every shard of the table's latest stream from its oldest record (TRIM_HORIZON), newest first.
 * The stream ARN is resolved in the same read: turning a stream on again replaces it, and Floci drops the previous one.
 */
async function readStream(exec: Exec, tableName: string): Promise<StreamContents | null> {
  const table = await describeTable(exec, tableName);
  const streamArn = table.LatestStreamArn;
  if (!streamArn) return null;
  const description = await describeStream(exec, streamArn);
  const records: StreamRecord[] = [];
  let truncated = false;
  for (const shard of description.Shards ?? []) {
    let { ShardIterator: iterator } = await exec<{ ShardIterator?: string | null }>("dynamodbstreams", "GetShardIterator", {
      StreamArn: streamArn,
      ShardId: shard.ShardId,
      ShardIteratorType: "TRIM_HORIZON",
    });
    for (let page = 0; iterator && page < MAX_PAGES_PER_SHARD; page++) {
      const out = await exec<{ Records?: StreamRecord[] | null; NextShardIterator?: string | null }>("dynamodbstreams", "GetRecords", { ShardIterator: iterator, Limit: 1000 });
      const batch = out.Records ?? [];
      records.push(...batch);
      if (records.length >= MAX_RECORDS) {
        truncated = true;
        break;
      }
      if (batch.length === 0) break;
      iterator = out.NextShardIterator;
    }
    if (truncated) break;
  }
  return { streamArn, enabled: streamEnabled(table), description, records: records.sort(compareSequence).reverse().slice(0, MAX_RECORDS), truncated };
}

export function StreamsTab({ table }: { table: TableDescription }) {
  const enabled = streamEnabled(table);
  const [turningOn, setTurningOn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  const turnOff = useConsoleAction({
    run: (_: void, exec) => exec("dynamodb", "UpdateTable", { TableName: table.TableName, StreamSpecification: { StreamEnabled: false } }),
    successMessage: () => `Stream of table ${table.TableName} turned off`,
    onSuccess: () => setTurningOff(false),
  });

  return (
    <>
      <Panel
        title="DynamoDB stream details"
        description="A stream captures item-level changes of the table, in order, for up to 24 hours."
        actions={
          enabled ? (
            <Button onClick={() => setTurningOff(true)}>Turn off</Button>
          ) : (
            <Button variant="primary" onClick={() => setTurningOn(true)}>
              Turn on
            </Button>
          )
        }
      >
        <DetailsGrid
          items={[
            { label: "Stream status", value: enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge> },
            { label: "View type", value: enabled ? streamViewTypeLabel(table.StreamSpecification?.StreamViewType) : "-" },
            { label: "Latest stream ARN", value: table.LatestStreamArn ? <CopyableText value={table.LatestStreamArn} label="Copy stream ARN" /> : "-", wide: true },
          ]}
        />
      </Panel>
      {table.LatestStreamArn && (
        <LambdaTriggers eventSourceArn={table.LatestStreamArn} description="Functions invoked with batches of records from this stream. Add triggers from the Lambda console." stream />
      )}
      <StreamRecords tableName={table.TableName} />
      {turningOn && <TurnOnDialog table={table} onClose={() => setTurningOn(false)} />}
      <ConfirmDialog
        open={turningOff}
        onClose={() => {
          setTurningOff(false);
          turnOff.reset();
        }}
        onConfirm={() => turnOff.mutate()}
        title="Turn off stream"
        confirmLabel="Turn off"
        loading={turnOff.isPending}
        error={turnOff.error}
      >
        <p>
          Stop capturing changes of table <strong className="break-all">{table.TableName}</strong>? Lambda triggers on this stream stop receiving records. Records already in the stream stay readable for 24 hours.
        </p>
      </ConfirmDialog>
    </>
  );
}

function TurnOnDialog({ table, onClose }: { table: TableDescription; onClose: () => void }) {
  const [viewType, setViewType] = useState<StreamViewType>("NEW_AND_OLD_IMAGES");
  const turnOn = useConsoleAction<StreamViewType>({
    run: (type, exec) => exec("dynamodb", "UpdateTable", { TableName: table.TableName, StreamSpecification: { StreamEnabled: true, StreamViewType: type } }),
    successMessage: () => `Stream of table ${table.TableName} turned on`,
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Turn on DynamoDB stream"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={turnOn.isPending} onClick={() => turnOn.mutate(viewType)}>
            Turn on stream
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioCards legend="View type" name="stream-view-type" value={viewType} onChange={setViewType} options={STREAM_VIEW_TYPES} />
        <p className="text-xs text-aws-muted">The view type can&apos;t be changed while the stream is on. Turn the stream off and on again to use another one.</p>
        {turnOn.error && <ErrorAlert error={turnOn.error} />}
      </div>
    </Dialog>
  );
}

type EventFilter = "all" | EventName;
type Format = "json" | "dynamodb";

function StreamRecords({ tableName }: { tableName: string }) {
  const contents = useAwsLoader(["dynamodbstreams", "records", tableName], (exec) => readStream(exec, tableName));
  const [filter, setFilter] = useState<EventFilter>("all");
  const [format, setFormat] = useState<Format>("json");
  const [expanded, setExpanded] = useState<string | null>(null);
  const records = (contents.data?.records ?? []).filter((r) => filter === "all" || r.EventName === filter);
  const description = contents.data?.description;

  if (contents.data === null) {
    return (
      <Panel title="Stream records">
        <EmptyState title="No stream" description="Turn on the stream to capture item changes. Records appear here as items are created, updated and deleted." />
      </Panel>
    );
  }
  return (
    <Panel
      title="Stream records"
      count={contents.data ? records.length : undefined}
      description={
        description
          ? `Read from the oldest retained record of ${plural(description.Shards?.length ?? 0, "shard")}, newest first.${contents.data?.truncated ? ` Showing the latest ${MAX_RECORDS}.` : ""}${contents.data?.enabled ? "" : " The stream is off: no new records are captured."}`
          : undefined
      }
      bodyClassName="px-0! py-0!"
      actions={
        <Button onClick={() => contents.refetch()} loading={contents.isFetching}>
          Refresh
        </Button>
      }
    >
      {contents.error ? (
        <div className="px-5 py-4">
          <ErrorAlert error={contents.error} />
        </div>
      ) : contents.isLoading || !contents.data ? (
        <Loading className="px-5" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-aws-border px-5 py-3">
            <SegmentedControl
              legend="Event type"
              name="stream-event-type"
              value={filter}
              onChange={setFilter}
              hideLegend
              options={[
                { value: "all", label: "All" },
                { value: "INSERT", label: "Insert" },
                { value: "MODIFY", label: "Modify" },
                { value: "REMOVE", label: "Remove" },
              ]}
            />
            <SegmentedControl
              legend="Attribute format"
              name="stream-format"
              value={format}
              onChange={setFormat}
              hideLegend
              options={[
                { value: "json", label: "JSON" },
                { value: "dynamodb", label: "DynamoDB JSON" },
              ]}
            />
          </div>
          {records.length === 0 ? (
            <EmptyState
              title="No records"
              description={contents.data.records.length ? "No records of this event type." : "Create, update or delete items of the table: each change appears here as a record."}
            />
          ) : (
            <Table aria-label="Stream records" className="[&_tbody_tr:last-child_td]:border-b-0">
              <thead>
                <tr>
                  <Th className="pl-5">Sequence number</Th>
                  <Th>Event</Th>
                  <Th>Keys</Th>
                  <Th>Approximate time</Th>
                  <Th className="pr-5 text-right">Size</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const id = r.EventID ?? r.Dynamodb?.SequenceNumber ?? "";
                  const open = expanded === id;
                  const keys = Object.entries(r.Dynamodb?.Keys ?? {});
                  return (
                    <Fragment key={id}>
                      <Tr>
                        <Td className="pl-5">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : id)}
                            className="flex items-center gap-1 text-left font-mono text-xs leading-5 font-bold text-aws-link hover:underline"
                          >
                            {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
                            {r.Dynamodb?.SequenceNumber ?? "-"}
                          </button>
                        </Td>
                        <Td>{r.EventName ? <Badge tone={EVENT_TONES[r.EventName]}>{r.EventName}</Badge> : "-"}</Td>
                        <Td className="font-mono text-xs leading-5 break-all">{keys.map(([k, v]) => `${k}: ${displayValue(v)}`).join(", ") || "-"}</Td>
                        <Td className="whitespace-nowrap">{formatDateTime(r.Dynamodb?.ApproximateCreationDateTime)}</Td>
                        <Td className="pr-5 text-right whitespace-nowrap">{formatBytes(r.Dynamodb?.SizeBytes)}</Td>
                      </Tr>
                      {open && (
                        <tr>
                          <td colSpan={5} className={cn("border-b border-aws-border bg-aws-panel/60 px-5 py-4")}>
                            <RecordImages record={r} format={format} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          )}
        </>
      )}
    </Panel>
  );
}

function RecordImages({ record, format }: { record: StreamRecord; format: Format }) {
  const images: { label: string; item?: DynamoItem }[] = [
    { label: "Old image", item: record.Dynamodb?.OldImage },
    { label: "New image", item: record.Dynamodb?.NewImage },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {images.map(({ label, item }) => (
        <div key={label} className="min-w-0">
          <p className="mb-1 text-sm font-bold">{label}</p>
          {item ? (
            <pre aria-label={label} className="max-h-80 overflow-auto rounded-lg border border-aws-border bg-aws-surface p-3 font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(format === "json" ? unmarshallItem(item) : item, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-aws-muted">{record.EventName === "INSERT" && label === "Old image" ? "None: the item was created." : record.EventName === "REMOVE" && label === "New image" ? "None: the item was deleted." : "Not captured by this view type."}</p>
          )}
        </div>
      ))}
    </div>
  );
}
