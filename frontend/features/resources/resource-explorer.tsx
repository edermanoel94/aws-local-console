"use client";

import { useDeferredValue, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { Button, Drawer, EmptyState, ErrorAlert, Loading, Panel, SelectField } from "@/components/ui";
import { useRegions, useResources, useServices } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { ResourceTable } from "./resource-table";
import { ResourceDetail } from "./resource-detail";
import { useUpdateSearchParams } from "@/hooks/use-update-search-params";

const INPUT =
  "h-[34px] w-full rounded-lg border border-aws-border-strong bg-aws-surface px-2.5 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none";

/** Cross-service resource search with service / region / tag filters and a detail drawer. */
export function ResourceExplorer() {
  const searchParams = useSearchParams();
  const ids = useId();
  const globalRegion = useRegion();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [service, setService] = useState(searchParams.get("service") ?? "");
  const [regionOverride, setRegionOverride] = useState<string | null>(searchParams.get("region"));
  const [tag, setTag] = useState(searchParams.get("tag") ?? "");
  // "*" = all regions (the API lists every region when no region is given).
  const ALL = "*";
  const region = regionOverride ?? globalRegion;
  const selectedId = searchParams.get("id");

  const deferredQ = useDeferredValue(q.trim());
  const deferredTag = useDeferredValue(tag.trim());
  const resources = useResources({ region: region === ALL ? undefined : region, service: service || undefined, q: deferredQ || undefined, tag: deferredTag || undefined });
  const services = useServices();
  const regions = useRegions();
  const selected = resources.data?.resources.find((r) => r.id === selectedId);

  const updateSearchParams = useUpdateSearchParams();
  const setParam = (key: string, value: string | null) => updateSearchParams({ [key]: value });

  const filtersActive = !!(q || service || tag || regionOverride);
  const regionOptions = [
    { value: ALL, label: "All regions" },
    ...(regions.data ?? [{ name: globalRegion, label: globalRegion, default: true }]).map((r) => ({ value: r.name, label: r.name })),
  ];
  if (!regionOptions.some((o) => o.value === region)) regionOptions.push({ value: region, label: region });

  return (
    <>
      <Panel
        title="Resources"
        count={resources.data?.total ?? resources.data?.resources.length}
        description="Everything discovered in Floci for the selected region."
        actions={
          <Button onClick={() => resources.refetch()} loading={resources.isFetching && !resources.isPending}>
            {!(resources.isFetching && !resources.isPending) && <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className={"grid grid-cols-2 items-end gap-3 border-b border-aws-border px-5 py-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]"}>
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
                placeholder="Name, ARN or tag"
                className={`${INPUT} pl-8`}
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
            label="Region"
            className="min-w-0"
            value={region}
            onChange={(e) => {
              setRegionOverride(e.target.value);
              setParam("region", e.target.value);
            }}
            options={regionOptions}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${ids}-tag`} className="text-sm font-bold">
              Tag
            </label>
            <input
              id={`${ids}-tag`}
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setParam("tag", e.target.value);
              }}
              placeholder="key=value"
              className={INPUT}
            />
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => {
                setQ("");
                setService("");
                setTag("");
                setRegionOverride(null);
                updateSearchParams({ q: null, service: null, tag: null, region: null, id: null });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {resources.data && resources.data.errors.length > 0 && (
          <div className="flex items-start gap-2 border-b border-aws-border bg-aws-warning-bg px-5 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aws-orange-dark" aria-hidden />
            <p>
              Some services could not be listed:{" "}
              {resources.data.errors.map((e) => (
                <span key={e.service} className="mr-2">
                  <strong>{e.service}</strong> ({e.message})
                </span>
              ))}
            </p>
          </div>
        )}

        {resources.isPending ? (
          <Loading className="px-5" />
        ) : resources.isError ? (
          <div className="p-5">
            <ErrorAlert error={resources.error} />
          </div>
        ) : resources.data.resources.length === 0 ? (
          <EmptyState
            title={filtersActive ? "No resources match the filters" : "No resources"}
            description={filtersActive ? "Try another search term, service, region or tag." : `Nothing exists yet in ${region === ALL ? "any region" : region}. Create resources from a service console.`}
          />
        ) : (
          <ResourceTable resources={resources.data.resources} selectedId={selectedId} onSelect={(id) => setParam("id", id)} />
        )}
      </Panel>

      <Drawer open={!!selectedId} onClose={() => setParam("id", null)} title={selected?.name ?? "Resource"} subtitle={selected ? `${selected.service} ${selected.type} · ${selected.region}` : undefined}>
        {selected ? <ResourceDetail resource={selected} /> : resources.isPending ? <Loading /> : <p className="text-sm text-aws-muted">This resource is not in the current results.</p>}
      </Drawer>
    </>
  );
}
