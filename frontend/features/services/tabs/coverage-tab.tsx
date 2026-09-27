"use client";

import { useMemo, useState } from "react";
import type { Coverage, ServiceDetail } from "@/types/api";
import { EmptyState, Panel, SelectField, Table, Td, Th, Tr } from "@/components/ui";
import { CoverageBadge, CoverageBar } from "@/components/aws/status-badges";
import { cn } from "@/lib/cn";

const CARDS: { key: Coverage; label: string; description: string; tone: string }[] = [
  { key: "supported", label: "Supported", description: "Succeeded (or returned a regular AWS error) on Floci", tone: "text-aws-green" },
  { key: "unsupported", label: "Unsupported", description: "Floci answered as not implemented", tone: "text-aws-red" },
  { key: "untested", label: "Untested", description: "Not executed yet in this session", tone: "text-aws-muted" },
];

/** Coverage summary cards + per-operation coverage table. */
export function CoverageTab({ service: s }: { service: ServiceDetail }) {
  const [filter, setFilter] = useState<string>("");
  const total = s.coverage.supported + s.coverage.unsupported + s.coverage.untested;
  const ops = useMemo(() => [...s.operations].filter((o) => !filter || o.coverage === filter).sort((a, b) => a.coverage.localeCompare(b.coverage) || a.name.localeCompare(b.name)), [s.operations, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <section key={c.key} aria-label={`${c.label} operations`} className="rounded-2xl border border-aws-border bg-aws-surface px-5 py-4 shadow-sm">
            <h2 className="text-sm font-bold text-aws-muted">{c.label}</h2>
            <p className={cn("mt-1 text-3xl font-light tabular-nums", c.tone)}>
              {s.coverage[c.key]}
              <span className="ml-2 text-sm text-aws-muted">{total ? Math.round((s.coverage[c.key] / total) * 100) : 0}%</span>
            </p>
            <p className="mt-1 text-xs text-aws-muted">{c.description}</p>
          </section>
        ))}
      </div>
      <Panel title="Coverage by operation" count={ops.length} actions={<CoverageBar coverage={s.coverage} className="w-72" />} bodyClassName="p-0">
        <div className="flex items-end gap-3 border-b border-aws-border px-5 py-3">
          <SelectField
            label="Coverage"
            className="w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[{ value: "", label: "All" }, ...CARDS.map((c) => ({ value: c.key, label: c.label }))]}
          />
        </div>
        {ops.length === 0 ? (
          <EmptyState title="No operations in this state" />
        ) : (
          <Table className="[&_td]:align-middle" aria-label="Coverage by operation">
            <thead>
              <tr>
                <Th className="pl-5">Operation</Th>
                <Th>Access</Th>
                <Th className="pr-5">Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <Tr key={o.name}>
                  <Td className="pl-5 font-mono text-[13px]">{o.name}</Td>
                  <Td className="text-aws-muted">{o.mutating ? "Write" : "Read"}</Td>
                  <Td className="pr-5">
                    <CoverageBadge coverage={o.coverage} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
