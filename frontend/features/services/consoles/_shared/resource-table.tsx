"use client";

import { useId, useState, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button, EmptyState, ErrorAlert, Loading, Panel, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Icon-only refresh button (accessible name "Refresh", CONTRACT section 6). */
export function RefreshButton({ onClick, spinning, label = "Refresh" }: { onClick: () => void; spinning?: boolean; label?: string }) {
  return (
    <Button aria-label={label} title={label} onClick={onClick} className="w-8 px-0!">
      <RefreshCw className={cn("size-4 shrink-0", spinning && "animate-spin")} aria-hidden />
    </Button>
  );
}

/** Client-side filter input (label "Search"). */
export function SearchInput({ value, onChange, placeholder, label = "Search" }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  const id = useId();
  return (
    <div className="relative w-full max-w-md">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-aws-muted" aria-hidden />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-aws-border-strong bg-aws-surface py-1.5 pr-2.5 pl-8 text-sm text-aws-ink placeholder:text-aws-muted focus:border-aws-link focus:ring-1 focus:ring-aws-link focus:outline-none"
      />
    </div>
  );
}

/** Generic AWS console style list: title with counter, refresh, actions, search, table and all states. */
export function ResourceTable<T>({
  title,
  description,
  items,
  columns,
  rowKey,
  filterText,
  searchPlaceholder,
  emptyTitle,
  emptyDescription,
  loading,
  fetching,
  error,
  onRefresh,
  actions,
  toolbar,
  label,
}: {
  title: string;
  description?: ReactNode;
  items: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  filterText: (row: T) => string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  loading?: boolean;
  fetching?: boolean;
  error?: unknown;
  onRefresh?: () => void;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** Accessible table label, defaults to the title. */
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = (items ?? []).filter((row) => filterText(row).toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Panel
      title={title}
      count={items?.length}
      description={description}
      bodyClassName="px-0! py-0!"
      actions={
        <>
          {onRefresh && <RefreshButton onClick={onRefresh} spinning={fetching} />}
          {actions}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <SearchInput value={query} onChange={setQuery} placeholder={searchPlaceholder} />
        {toolbar}
        {items && query && (
          <span className="text-sm text-aws-muted">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </span>
        )}
      </div>
      {error ? (
        <div className="px-5 pb-4">
          <ErrorAlert error={error} />
        </div>
      ) : loading || !items ? (
        <Loading className="px-5" />
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description={`No ${title.toLowerCase()} match "${query}".`} />
      ) : (
        <Table aria-label={label ?? title} className="[&_tbody_tr:last-child_td]:border-b-0">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <Th key={c.header} className={cn(i === 0 && "pl-5", i === columns.length - 1 && "pr-5", c.className)}>
                  {c.header}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <Tr key={rowKey(row)}>
                {columns.map((c, i) => (
                  <Td key={c.header} className={cn(i === 0 && "pl-5", i === columns.length - 1 && "pr-5", c.className)}>
                    {c.cell(row)}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
