"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, MiniMap, Panel as FlowPanel, ReactFlow, type Edge } from "@xyflow/react";
import { useResolvedTheme } from "@/hooks/use-theme";
import { CANVAS_COLORS } from "@/lib/theme";
import { AlertTriangle, ArrowRight, Network, RefreshCw, X } from "lucide-react";
import type { ArchitectureGraph } from "@/types/api";
import { Button, EmptyState, ErrorAlert, Loading, Panel, SelectField, Table, Td, Th, Tr } from "@/components/ui";
import { ServiceIcon, SERVICE_SHORT_NAMES, serviceColor } from "@/components/aws/service-icon";
import { useArchitecture } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { layeredLayout } from "./layout";
import { ResourceNode, type ResourceFlowNode } from "./resource-node";

const nodeTypes = { resource: ResourceNode };

type GraphNode = ArchitectureGraph["nodes"][number];

/** Architecture Explorer: React Flow graph of resources and the relationships discovered in Floci. */
export function ArchitectureView() {
  const graph = useArchitecture();
  const region = useRegion();
  const [service, setService] = useState("");
  const [hideIsolated, setHideIsolated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const theme = useResolvedTheme();
  const canvas = CANVAS_COLORS[theme];

  const data = graph.data;
  const servicesInGraph = useMemo(() => [...new Set((data?.nodes ?? []).map((n) => n.service))].sort(), [data]);

  const view = useMemo(() => {
    if (!data) return null;
    const connectedIds = new Set(data.edges.flatMap((e) => [e.source, e.target]));
    // Service filter keeps matching nodes plus their direct neighbors (dimmed) for context.
    const primary = new Set(data.nodes.filter((n) => !service || n.service === service).map((n) => n.id));
    const visible = new Set(primary);
    if (service) {
      for (const e of data.edges) {
        if (primary.has(e.source)) visible.add(e.target);
        if (primary.has(e.target)) visible.add(e.source);
      }
    }
    const nodes = data.nodes.filter((n) => visible.has(n.id) && (!hideIsolated || connectedIds.has(n.id)));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const positions = layeredLayout(nodes, edges);

    const flowNodes: ResourceFlowNode[] = nodes.map((n) => ({
      id: n.id,
      type: "resource",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { service: n.service, type: n.type, name: n.name, arn: n.arn, dimmed: !!service && !primary.has(n.id) },
      ariaLabel: `${SERVICE_SHORT_NAMES[n.service] ?? n.service} ${n.type} ${n.name}`,
    }));
    const flowEdges: Edge[] = edges.map((e) => {
      const source = nodes.find((n) => n.id === e.source);
      const color = source ? serviceColor(source.service) : canvas.muted;
      const highlighted = !!selectedId && (e.source === selectedId || e.target === selectedId);
      const target = nodes.find((n) => n.id === e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        ariaLabel: `${source?.name ?? e.source} ${e.label} ${target?.name ?? e.target}`,
        type: "smoothstep",
        animated: highlighted,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
        style: { stroke: color, strokeWidth: highlighted ? 2.5 : 1.5 },
        labelStyle: { fontSize: 11, fontWeight: 700, fill: canvas.ink },
        labelBgStyle: { fill: canvas.surface, fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
    // Node positions/sizes live in React Flow (uncontrolled) so it can measure and drag them; remount when the node set changes.
    const signature = `${service}|${hideIsolated}|${nodes.map((n) => n.id).join(",")}`;
    return { nodes, edges, flowNodes, flowEdges, signature };
  }, [data, service, hideIsolated, selectedId, canvas]);

  const selected = data?.nodes.find((n) => n.id === selectedId);
  const nameOf = (id: string) => data?.nodes.find((n) => n.id === id);

  return (
    <div className="flex flex-col gap-4">
      <Panel bodyClassName="flex flex-wrap items-end gap-4 py-3">
        <SelectField
          label="Service"
          className="w-52"
          value={service}
          onChange={(e) => setService(e.target.value)}
          options={[{ value: "", label: "All services" }, ...servicesInGraph.map((s) => ({ value: s, label: SERVICE_SHORT_NAMES[s] ?? s }))]}
        />
        <label className="flex h-[34px] cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-aws-link" checked={hideIsolated} onChange={(e) => setHideIsolated(e.target.checked)} />
          Hide resources without relationships
        </label>
        <div className="ml-auto flex items-center gap-4">
          {data && (
            <p className="text-sm text-aws-muted">
              <strong className="text-aws-ink">{data.nodes.length}</strong> resources · <strong className="text-aws-ink">{data.edges.length}</strong> relationships · {region}
            </p>
          )}
          <Button onClick={() => graph.refetch()} loading={graph.isFetching}>
            {!graph.isFetching && <RefreshCw className="size-4" aria-hidden />}
            Refresh
          </Button>
        </div>
      </Panel>

      {data?.errors && data.errors.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-aws-orange bg-aws-warning-bg px-4 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aws-orange-dark" aria-hidden />
          <span>
            Some relationships could not be collected:{" "}
            {data.errors.map((e) => (
              <span key={e.service} className="mr-2">
                <strong>{e.service}</strong> ({e.message})
              </span>
            ))}
          </span>
        </p>
      )}

      {graph.isPending ? (
        <Panel>
          <Loading label="Loading graph" />
        </Panel>
      ) : graph.isError ? (
        <ErrorAlert error={graph.error} />
      ) : !view || view.nodes.length === 0 ? (
        <Panel>
          <EmptyState
            title={data?.nodes.length ? "No resources match the filter" : "No resources to display"}
            description={data?.nodes.length ? "Pick another service or show all resources." : "Create resources (for example an SQS queue consumed by a Lambda function) and refresh."}
            action={<Link href="/services">Browse services</Link>}
          />
        </Panel>
      ) : (
        <>
          <section aria-label="Architecture graph" className="relative h-[calc(100vh-17rem)] min-h-[520px] overflow-hidden rounded-2xl border border-aws-border bg-aws-surface shadow-sm">
            <ReactFlow
              key={view.signature}
              colorMode={theme}
              defaultNodes={view.flowNodes}
              edges={view.flowEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
              minZoom={0.2}
              nodesDraggable
              nodesConnectable={false}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
            >
              <Background gap={20} size={1.2} color={canvas.grid} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap pannable zoomable nodeColor={(n) => serviceColor((n.data as { service: string }).service)} nodeStrokeWidth={0} position="bottom-right" className="rounded-lg! border! border-aws-border!" />
              {selected && (
                <FlowPanel position="top-right">
                  <NodeDetails node={selected} graph={data} onClose={() => setSelectedId(null)} />
                </FlowPanel>
              )}
            </ReactFlow>
          </section>

          <Panel title="Relationships" count={view.edges.length} bodyClassName="p-0">
            {view.edges.length === 0 ? (
              <EmptyState title="No relationships discovered" description="Event source mappings, subscriptions, rule targets, integrations, notifications and environment references show up here." />
            ) : (
              <Table className="[&_td]:align-middle" aria-label="Relationships">
                <thead>
                  <tr>
                    <Th className="pl-5">Source</Th>
                    <Th>Relationship</Th>
                    <Th className="pr-5">Target</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.edges.map((e) => {
                    const s = nameOf(e.source);
                    const t = nameOf(e.target);
                    return (
                      <Tr key={e.id}>
                        <Td className="pl-5">{s && <NodeRef node={s} />}</Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5 text-aws-muted">
                            <ArrowRight className="size-3.5" aria-hidden />
                            {e.label}
                          </span>
                        </Td>
                        <Td className="pr-5">{t && <NodeRef node={t} />}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function NodeRef({ node }: { node: GraphNode }) {
  return (
    <span className="flex items-center gap-2">
      <ServiceIcon service={node.service} size="sm" />
      <span className="text-aws-muted">{SERVICE_SHORT_NAMES[node.service] ?? node.service}</span>
      <span className="font-bold">{node.name}</span>
    </span>
  );
}

function NodeDetails({ node, graph, onClose }: { node: GraphNode; graph?: ArchitectureGraph; onClose: () => void }) {
  const incoming = graph?.edges.filter((e) => e.target === node.id) ?? [];
  const outgoing = graph?.edges.filter((e) => e.source === node.id) ?? [];
  const byId = (id: string) => graph?.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="w-80 rounded-xl border border-aws-border-strong bg-aws-surface p-4 text-sm shadow-lg">
      <div className="flex items-start gap-3">
        <ServiceIcon service={node.service} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{node.name}</p>
          <p className="text-xs text-aws-muted">
            {SERVICE_SHORT_NAMES[node.service] ?? node.service} {node.type}
          </p>
        </div>
        <button type="button" aria-label="Close details" onClick={onClose} className="rounded p-0.5 text-aws-muted hover:bg-aws-panel">
          <X className="size-4" />
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] break-all text-aws-muted">{node.arn}</p>
      {(incoming.length > 0 || outgoing.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-aws-border pt-3 text-xs">
          {incoming.map((e) => (
            <li key={e.id}>
              <span className="text-aws-muted">{e.label} from</span> <strong>{byId(e.source)}</strong>
            </li>
          ))}
          {outgoing.map((e) => (
            <li key={e.id}>
              <span className="text-aws-muted">{e.label} to</span> <strong>{byId(e.target)}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-3 border-t border-aws-border pt-3 text-xs font-bold">
        <Link href={`/resources?q=${encodeURIComponent(node.name)}&id=${encodeURIComponent(node.id)}`}>Resource details</Link>
        <Link href={`/services/${node.service}?tab=resources`} className="inline-flex items-center gap-1">
          <Network className="size-3" aria-hidden /> Console
        </Link>
      </div>
    </div>
  );
}
