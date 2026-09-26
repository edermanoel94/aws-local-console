"use client";

import type { Resource } from "@/types/api";
import { Table, Td, Th, Tr } from "@/components/ui";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { formatDateTime } from "@/lib/format";

/** Generic resource table (name, type, service, region, ARN, tags). Row click selects. */
export function ResourceTable({
  resources,
  selectedId,
  onSelect,
  showService = true,
}: {
  resources: Resource[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  showService?: boolean;
}) {
  const hasCreated = resources.some((r) => r.createdAt);
  return (
    <Table className="[&_td]:align-middle" aria-label="Resources">
      <thead>
        <tr>
          <Th className="pl-5">Name</Th>
          <Th>Type</Th>
          {showService && <Th>Service</Th>}
          <Th>Region</Th>
          <Th>ARN</Th>
          <Th className={hasCreated ? "pr-5 xl:pr-3" : "pr-5"}>Tags</Th>
          {hasCreated && <Th className="hidden pr-5 xl:table-cell">Created</Th>}
        </tr>
      </thead>
      <tbody>
        {resources.map((r) => (
          <Tr key={r.id} selected={r.id === selectedId} className="cursor-pointer" onClick={() => onSelect(r.id)}>
            <Td className="max-w-56 pl-5 xl:max-w-64">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(r.id);
                }}
                className="max-w-full truncate text-left font-bold text-aws-link hover:underline"
              >
                {r.name}
              </button>
            </Td>
            <Td className="whitespace-nowrap">{r.type}</Td>
            {showService && (
              <Td>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <ServiceIcon service={r.service} size="sm" />
                  {SERVICE_SHORT_NAMES[r.service] ?? r.service}
                </span>
              </Td>
            )}
            <Td className="whitespace-nowrap text-aws-muted">{r.region}</Td>
            <Td className="max-w-52 xl:max-w-72">
              <span className="block truncate font-mono text-[12px] text-aws-muted" title={r.arn}>
                {r.arn}
              </span>
            </Td>
            <Td className={hasCreated ? "pr-5 xl:pr-3" : "pr-5"}>
              {r.tags.length === 0 ? (
                <span className="text-aws-muted">-</span>
              ) : (
                <span className="flex max-w-72 flex-wrap gap-1">
                  {r.tags.slice(0, 3).map((t) => (
                    <span key={t.key} className="rounded bg-aws-panel px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap">
                      {t.key}={t.value}
                    </span>
                  ))}
                  {r.tags.length > 3 && <span className="text-xs text-aws-muted">+{r.tags.length - 3}</span>}
                </span>
              )}
            </Td>
            {hasCreated && <Td className="hidden pr-5 xl:table-cell font-mono text-[12px] whitespace-nowrap text-aws-muted">{formatDateTime(r.createdAt)}</Td>}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
