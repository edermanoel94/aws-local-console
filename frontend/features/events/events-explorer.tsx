"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, FileText, RefreshCw, Search } from "lucide-react";
import type { ResourceEvent } from "@/types/api";
import { Badge, Button, Drawer, EmptyState, ErrorAlert, JsonView, Loading, Panel, SelectField, Table, Td, Th, Tr } from "@/components/ui";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { useEvents, useServices } from "@/hooks/use-queries";
import { formatDateTime } from "@/lib/format";

const KNOWN_TYPES = ["ResourceCreated", "ResourceUpdated", "ResourceDeleted", "MessagePublished", "FunctionInvoked", "ObjectUploaded"];

function typeTone(type: string) {
  if (type.endsWith("Created")) return "green" as const;
  if (type.endsWith("Deleted")) return "red" as const;
  if (type.endsWith("Updated")) return "blue" as const;
  return "orange" as const;
}

/** Resource lifecycle events with filters and a detail drawer (related resources + originating log). */
export function EventsExplorer() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ids = useId();
  const [service, setService] = useState(searchParams.get("service") ?? "");
  const [type, setType] = useState(searchParams.get("type") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const selectedId = searchParams.get("id");
  const deferredQ = useDeferredValue(q.trim());

  const events = useEvents({ service: service || undefined, type: type || undefined, q: deferredQ || undefined, limit: 200 }, autoRefresh ? 5_000 : false);
  const services = useServices();
  const selected = events.data?.find((e) => e.id === selectedId);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const typeOptions = useMemo(() => {
    const all = new Set([...KNOWN_TYPES, ...(events.data ?? []).map((e) => e.type)]);
    return [{ value: "", label: "All types" }, ...[...all].sort().map((t) => ({ value: t, label: t }))];
  }, [events.data]);

  const filtersActive = !!(service || type || q);

  return (
    <>
      <Panel
        title="Events"
        count={events.data?.length}
        description="Derived from successful mutating operations against Floci."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-aws-link" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto refresh
            </label>
            <Button onClick={() => events.refetch()}>
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        <div className={"grid grid-cols-2 items-end gap-3 border-b border-aws-border px-5 py-3 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto]"}>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${ids}-q`} className="text-sm font-bold">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-aws-muted" aria-hidden />
              <input
                id={`${ids}-q`}
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setParam("q", e.target.value);
                }}
                placeholder="Resource name or ARN"
                className="h-[34px] w-full rounded-lg border border-aws-border-strong bg-white pr-3 pl-8 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
              />
            </div>
          </div>
          <SelectField
            label="Service"
            className="min-w-0"
            value={service}
            onChange={(e) => {
              setService(e.target.value);
              setParam("service", e.target.value);
            }}
            options={[{ value: "", label: "All services" }, ...(services.data ?? []).map((s) => ({ value: s.id, label: s.shortName }))]}
          />
          <SelectField
            label="Type"
            className="min-w-0"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setParam("type", e.target.value);
            }}
            options={typeOptions}
          />
          {filtersActive && (
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => {
                setService("");
                setType("");
                setQ("");
                router.replace(pathname, { scroll: false });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {events.isPending ? (
          <Loading className="px-5" />
        ) : events.isError ? (
          <div className="p-5">
            <ErrorAlert error={events.error} />
          </div>
        ) : events.data.length === 0 ? (
          <EmptyState
            title={filtersActive ? "No events match the filters" : "No events yet"}
            description={filtersActive ? "Adjust or clear the filters." : "Create, update or delete a resource to generate events."}
          />
        ) : (
          <Table className="[&_td]:align-middle" aria-label="Events">
            <thead>
              <tr>
                <Th className="pl-5">Time</Th>
                <Th>Service</Th>
                <Th>Type</Th>
                <Th>Resource</Th>
                <Th className="pr-5 2xl:pr-3">Operation</Th>
                <Th className="hidden pr-5 2xl:table-cell">Region</Th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((ev) => (
                <Tr key={ev.id} selected={ev.id === selectedId} className="cursor-pointer" onClick={() => setParam("id", ev.id)}>
                  <Td className="pl-5 font-mono text-[12px] whitespace-nowrap text-aws-muted">
                    <time dateTime={ev.timestamp}>{formatDateTime(ev.timestamp)}</time>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <ServiceIcon service={ev.service} size="sm" />
                      {SERVICE_SHORT_NAMES[ev.service] ?? ev.service}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={typeTone(ev.type)}>{ev.type}</Badge>
                  </Td>
                  <Td className="max-w-52 xl:max-w-72">
                    <button
                      type="button"
                      className="max-w-full truncate text-left text-aws-link hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setParam("id", ev.id);
                      }}
                    >
                      {ev.resourceName ?? ev.id}
                    </button>
                    {ev.related.length > 0 && <p className="text-xs text-aws-muted">+{ev.related.length} related</p>}
                  </Td>
                  <Td className="max-w-48 truncate pr-5 font-mono text-[13px] xl:max-w-none 2xl:pr-3" title={ev.operation}>{ev.operation}</Td>
                  <Td className="hidden pr-5 whitespace-nowrap text-aws-muted 2xl:table-cell">{ev.region}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Drawer open={!!selectedId} onClose={() => setParam("id", null)} title={selected ? selected.type : "Event"} subtitle={selected ? formatDateTime(selected.timestamp) : undefined}>
        {selected ? <EventDetail event={selected} /> : events.isPending ? <Loading /> : <p className="text-sm text-aws-muted">This event is no longer in the list.</p>}
      </Drawer>
    </>
  );
}

function EventDetail({ event: ev }: { event: ResourceEvent }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <Item label="Service">{SERVICE_SHORT_NAMES[ev.service] ?? ev.service}</Item>
        <Item label="Type">
          <Badge tone={typeTone(ev.type)}>{ev.type}</Badge>
        </Item>
        <Item label="Operation">
          <span className="font-mono text-[13px]">{ev.operation}</span>
        </Item>
        <Item label="Region">{ev.region}</Item>
        <Item label="Timestamp">
          <time dateTime={ev.timestamp}>{formatDateTime(ev.timestamp)}</time>
        </Item>
        <Item label="Resource">{ev.resourceName ?? "-"}</Item>
        <div className="col-span-2">
          <dt className="text-xs text-aws-muted">ARN</dt>
          <dd className="mt-0.5 font-mono text-[12px] break-all">{ev.resourceArn ?? "-"}</dd>
        </div>
      </dl>

      <section>
        <h3 className="mb-2 font-bold">Originating log</h3>
        <Link href={`/logs?id=${encodeURIComponent(ev.logId)}`} className="flex items-center gap-2 rounded-lg border border-aws-border px-3 py-2 hover:bg-aws-panel">
          <FileText className="size-4 text-aws-muted" aria-hidden />
          <span className="flex-1">
            View log <span className="font-mono text-[12px]">{ev.logId}</span>
          </span>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      <section aria-label="Related resources">
        <h3 className="mb-2 font-bold">Related resources ({ev.related.length})</h3>
        {ev.related.length === 0 ? (
          <p className="text-aws-muted">No related resources.</p>
        ) : (
          <ul className="divide-y divide-aws-border rounded-lg border border-aws-border">
            {ev.related.map((r) => (
              <li key={`${r.service}:${r.name}`} className="flex items-center gap-3 px-3 py-2">
                <ServiceIcon service={r.service} size="sm" />
                <div className="min-w-0">
                  <Link href={`/resources?q=${encodeURIComponent(r.name)}`} className="block truncate font-bold">
                    {r.name}
                  </Link>
                  {r.arn && <p className="truncate font-mono text-[11px] text-aws-muted">{r.arn}</p>}
                </div>
                <span className="text-xs text-aws-muted">{SERVICE_SHORT_NAMES[r.service] ?? r.service}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-bold">Detail</h3>
        <JsonView value={ev.detail} label="Event detail" />
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-aws-muted">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}
