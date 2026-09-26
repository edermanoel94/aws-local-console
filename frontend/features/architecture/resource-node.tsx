"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ServiceIcon, SERVICE_SHORT_NAMES, serviceColor } from "@/components/aws/service-icon";
import { cn } from "@/lib/cn";

export type ResourceNodeData = {
  service: string;
  type: string;
  name: string;
  arn: string;
  dimmed?: boolean;
};

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

/** Architecture node: service icon, service short name (e.g. "SQS") and resource name. */
export const ResourceNode = memo(function ResourceNode({ data, selected }: NodeProps<ResourceFlowNode>) {
  const shortName = SERVICE_SHORT_NAMES[data.service] ?? data.service;
  return (
    <div
      className={cn(
        "flex h-[68px] w-[232px] items-center gap-3 rounded-xl border bg-white px-3 shadow-sm transition-[opacity,box-shadow]",
        selected ? "border-aws-link ring-2 ring-aws-link/30" : "border-aws-border-strong hover:shadow-md",
        data.dimmed && "opacity-40",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: serviceColor(data.service) }}
      title={data.arn}
    >
      <Handle type="target" position={Position.Left} className="size-2! border-white! bg-aws-border-strong!" />
      <ServiceIcon service={data.service} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-4 text-aws-muted">
          <span className="font-bold text-aws-ink/80">{shortName}</span>
          <span aria-hidden> · </span>
          <span>{data.type}</span>
        </p>
        <p className="truncate text-sm leading-5 font-bold text-aws-ink">{data.name}</p>
      </div>
      <Handle type="source" position={Position.Right} className="size-2! border-white! bg-aws-border-strong!" />
    </div>
  );
});
