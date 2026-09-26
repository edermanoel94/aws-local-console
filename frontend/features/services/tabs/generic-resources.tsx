"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ServiceDetail } from "@/types/api";
import { Button, Drawer, EmptyState, ErrorAlert, Loading, Panel } from "@/components/ui";
import { useServiceResources } from "@/hooks/use-queries";
import { ResourceTable } from "@/features/resources/resource-table";
import { ResourceDetail } from "@/features/resources/resource-detail";

/** Fallback Resources tab for services without a dedicated console: generic table from /resources/:service. */
export function GenericResources({ service: s }: { service: ServiceDetail }) {
  const resources = useServiceResources(s.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = resources.data?.resources.find((r) => r.id === selectedId);
  const kind = s.resourceTypes[0] ?? "resource";

  return (
    <>
      <Panel
        title="Resources"
        count={resources.data?.resources.length}
        description={`${s.shortName} ${s.resourceTypes.join(", ") || "resources"} discovered in Floci. Use the API Explorer tab to create or change them.`}
        actions={
          <Button onClick={() => resources.refetch()} loading={resources.isFetching && !resources.isPending}>
            {!(resources.isFetching && !resources.isPending) && <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </Button>
        }
        bodyClassName="p-0"
      >
        {resources.isPending ? (
          <Loading className="px-5" />
        ) : resources.isError ? (
          <div className="p-5">
            <ErrorAlert error={resources.error} />
          </div>
        ) : resources.data.resources.length === 0 ? (
          <EmptyState title={`No ${kind}s`} description={`No ${s.shortName} ${kind}s exist in this region yet.`} />
        ) : (
          <ResourceTable resources={resources.data.resources} selectedId={selectedId} onSelect={setSelectedId} showService={false} />
        )}
      </Panel>
      <Drawer open={!!selected} onClose={() => setSelectedId(null)} title={selected?.name ?? ""} subtitle={selected ? `${selected.type} · ${selected.region}` : undefined}>
        {selected && <ResourceDetail resource={selected} />}
      </Drawer>
    </>
  );
}
