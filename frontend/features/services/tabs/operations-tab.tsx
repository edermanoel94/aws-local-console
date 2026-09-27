"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Play, Search } from "lucide-react";
import type { ServiceDetail } from "@/types/api";
import { Badge, EmptyState, Panel, SelectField, Table, Td, Th, Tr } from "@/components/ui";
import { CoverageBadge } from "@/components/aws/status-badges";
import { useTarget } from "@/hooks/use-queries";

/** Searchable operation list with coverage (Floci only) and a "Try it" shortcut into the API Explorer. */
export function OperationsTab({ service: s }: { service: ServiceDetail }) {
  const [q, setQ] = useState("");
  const { isFloci } = useTarget();
  const [coverage, setCoverage] = useState("");
  const [access, setAccess] = useState("");
  const query = q.trim().toLowerCase();

  const ops = useMemo(
    () =>
      [...s.operations]
        .filter(
          (o) =>
            (!query || o.name.toLowerCase().includes(query)) &&
            (!isFloci || !coverage || o.coverage === coverage) &&
            (!access || (access === "write") === o.mutating),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [s.operations, query, isFloci, coverage, access],
  );

  return (
    <Panel title="Operations" count={ops.length} description={`Every ${s.shortName} operation of the AWS SDK, executable through the generic engine.`} bodyClassName="p-0">
      <div className="flex flex-wrap items-end gap-3 border-b border-aws-border px-5 py-3">
        <div className="flex min-w-60 flex-[2] flex-col gap-1">
          <label htmlFor="operation-search" className="text-sm font-bold">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-aws-muted" aria-hidden />
            <input
              id="operation-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find operations"
              className="h-[34px] w-full rounded-lg border border-aws-border-strong bg-aws-surface pr-3 pl-8 text-sm placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
            />
          </div>
        </div>
        {isFloci && (
          <SelectField
            label="Coverage"
            className="min-w-36 flex-1"
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
            options={[
              { value: "", label: "Any coverage" },
              { value: "supported", label: "Supported" },
              { value: "unsupported", label: "Unsupported" },
              { value: "untested", label: "Untested" },
            ]}
          />
        )}
        <SelectField
          label="Access"
          className="min-w-32 flex-1"
          value={access}
          onChange={(e) => setAccess(e.target.value)}
          options={[
            { value: "", label: "Read and write" },
            { value: "read", label: "Read" },
            { value: "write", label: "Write" },
          ]}
        />
      </div>
      {ops.length === 0 ? (
        <EmptyState title="No operations match" description="Try another search term or filter." />
      ) : (
        <Table className="[&_td]:align-middle" aria-label="Operations">
          <thead>
            <tr>
              <Th className="pl-5">Operation</Th>
              <Th>Access</Th>
              {isFloci && <Th>Coverage</Th>}
              <Th>Required input</Th>
              <Th className="pr-5 text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const required = o.inputFields.filter((f) => f.required).map((f) => f.name);
              return (
                <Tr key={o.name}>
                  <Td className="pl-5 font-mono text-[13px] [overflow-wrap:anywhere]">{o.name}</Td>
                  <Td>
                    <Badge tone={o.mutating ? "orange" : "blue"}>{o.mutating ? "Write" : "Read"}</Badge>
                  </Td>
                  {isFloci && (
                    <Td>
                      <CoverageBadge coverage={o.coverage} />
                    </Td>
                  )}
                  <Td className="max-w-40 truncate xl:max-w-80 font-mono text-[12px] text-aws-muted" title={required.join(", ")}>
                    {required.length ? required.join(", ") : "-"}
                  </Td>
                  <Td className="pr-5 text-right">
                    <Link
                      href={`/api-explorer?service=${encodeURIComponent(s.id)}&operation=${encodeURIComponent(o.name)}`}
                      aria-label={`Try it: ${o.name}`}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-aws-border-strong px-3 text-xs font-bold text-aws-ink no-underline hover:bg-aws-panel"
                    >
                      <Play className="size-3" aria-hidden /> Try it
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
