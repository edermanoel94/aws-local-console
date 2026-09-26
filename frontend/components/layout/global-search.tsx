"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Braces, CornerDownLeft, Search, Tag } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys, useServices } from "@/hooks/use-queries";
import { useRegion } from "@/hooks/use-region";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { NAV_ITEMS } from "./navigation";

interface SearchItem {
  id: string;
  group: "Pages" | "Services" | "Resources" | "Operations";
  title: string;
  subtitle?: string;
  href: string;
  icon: ReactNode;
  badge?: string;
}

const GROUP_LIMITS: Record<SearchItem["group"], number> = { Pages: 4, Services: 6, Resources: 8, Operations: 8 };
const GROUP_ORDER: SearchItem["group"][] = ["Pages", "Services", "Resources", "Operations"];

/** Scores a candidate: 3 = exact, 2 = prefix, 1 = substring, 0 = no match. */
function score(query: string, ...fields: (string | undefined)[]): number {
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    const f = field.toLowerCase();
    if (f === query) return 3;
    if (f.startsWith(query)) best = Math.max(best, 2);
    else if (f.includes(query)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Global command palette (Ctrl+K / Cmd+K): pages, services, resources (name, ARN, tags) and operations.
 * Implements the ARIA combobox + listbox pattern with arrow key navigation.
 */
export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <Palette onClose={onClose} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const region = useRegion();
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();

  const services = useServices();
  const resources = useQuery({
    queryKey: queryKeys.resources({ region }),
    queryFn: () => api.resources({ region }),
    staleTime: 10_000,
  });
  const details = useQueries({
    queries: (services.data ?? []).map((s) => ({
      queryKey: queryKeys.service(s.id),
      queryFn: () => api.service(s.id),
      staleTime: 60_000,
      enabled: q.length >= 2,
    })),
  });

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const items = useMemo<SearchItem[]>(() => {
    const out: SearchItem[] = [];
    const pages = NAV_ITEMS.map((p) => ({ p, s: q ? score(q, p.label, p.description) : 1 })).filter((x) => x.s > 0);
    pages.sort((a, b) => b.s - a.s);
    for (const { p } of pages) {
      const Icon = p.icon;
      out.push({ id: `page:${p.href}`, group: "Pages", title: p.label, subtitle: p.description, href: p.href, icon: <Icon className="size-4 text-aws-muted" /> });
    }

    const svc = (services.data ?? [])
      .map((s) => ({ s, sc: q ? score(q, s.shortName, s.name, s.id, s.category) : 1 }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc);
    for (const { s } of svc) {
      out.push({
        id: `service:${s.id}`,
        group: "Services",
        title: s.shortName,
        subtitle: `${s.name} · ${s.category}`,
        href: `/services/${s.id}`,
        icon: <ServiceIcon service={s.id} category={s.category} size="sm" />,
      });
    }

    if (q) {
      const res = (resources.data?.resources ?? [])
        .map((r) => ({ r, sc: score(q, r.name, r.arn, r.type, ...r.tags.flatMap((t) => [t.key, t.value, `${t.key}=${t.value}`])) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc);
      for (const { r } of res) {
        const matchedTag = r.tags.find((t) => `${t.key}=${t.value}`.toLowerCase().includes(q));
        out.push({
          id: `resource:${r.id}`,
          group: "Resources",
          title: r.name,
          subtitle: r.arn,
          href: `/resources?q=${encodeURIComponent(r.name)}&id=${encodeURIComponent(r.id)}`,
          icon: <ServiceIcon service={r.service} size="sm" />,
          badge: matchedTag ? `${matchedTag.key}=${matchedTag.value}` : `${SERVICE_SHORT_NAMES[r.service] ?? r.service} ${r.type}`,
        });
      }
    }

    if (q.length >= 2) {
      const ops = details
        .flatMap((d) => d.data?.operations ?? [])
        .map((o) => ({ o, sc: score(q, o.name, `${o.service} ${o.name}`) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc || a.o.name.localeCompare(b.o.name));
      for (const { o } of ops) {
        out.push({
          id: `operation:${o.service}:${o.name}`,
          group: "Operations",
          title: o.name,
          subtitle: `${SERVICE_SHORT_NAMES[o.service] ?? o.service} operation`,
          href: `/api-explorer?service=${encodeURIComponent(o.service)}&operation=${encodeURIComponent(o.name)}`,
          icon: <Braces className="size-4 text-aws-muted" />,
          badge: o.coverage.charAt(0).toUpperCase() + o.coverage.slice(1),
        });
      }
    }

    const limited: SearchItem[] = [];
    for (const group of GROUP_ORDER) {
      limited.push(...out.filter((i) => i.group === group).slice(0, GROUP_LIMITS[group]));
    }
    return limited;
  }, [q, services.data, resources.data, details]);

  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));
  const activeItem = items[activeIndex];

  const activeId = activeItem?.id;
  useEffect(() => {
    if (!activeId) return;
    document.getElementById(optionId(listId, activeId))?.scrollIntoView({ block: "nearest" });
  }, [activeId, listId]);

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % Math.max(items.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(activeItem);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  const loadingOperations = q.length >= 2 && details.some((d) => d.isPending);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-aws-navy/50 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[70vh] w-full max-w-2xl animate-[palette-in_120ms_ease-out] flex-col overflow-hidden rounded-xl border border-aws-border-strong bg-white shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-aws-border px-4">
          <label htmlFor={inputId} className="flex items-center text-aws-muted">
            <Search className="size-5" aria-hidden />
            <span className="sr-only">Search</span>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? optionId(listId, activeItem.id) : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search services, resources, ARNs, tags and operations"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-aws-ink placeholder:text-aws-muted focus:outline-none"
          />
          <kbd className="rounded border border-aws-border-strong px-1.5 py-px text-[11px] text-aws-muted">Esc</kbd>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-aws-muted" role="presentation">
              {loadingOperations ? "Loading operations..." : `No results for "${query}"`}
            </li>
          )}
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <li key={group} role="presentation">
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-wide text-aws-muted uppercase" aria-hidden>
                  {group}
                </p>
                <ul role="group" aria-label={group}>
                  {groupItems.map((item) => {
                    const selected = item === activeItem;
                    return (
                      <li
                        key={item.id}
                        id={optionId(listId, item.id)}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setActive(items.indexOf(item))}
                        onClick={() => go(item)}
                        className={cn("mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", selected ? "bg-blue-50" : "hover:bg-aws-panel")}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-sm font-bold", selected ? "text-aws-link" : "text-aws-ink")}>{item.title}</span>
                          {item.subtitle && <span className="block truncate text-xs text-aws-muted">{item.subtitle}</span>}
                        </span>
                        {item.badge && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-aws-panel px-2 py-0.5 text-[11px] text-aws-muted">
                            {item.group === "Resources" && item.badge.includes("=") && <Tag className="size-3" aria-hidden />}
                            {item.badge}
                          </span>
                        )}
                        {selected && <CornerDownLeft className="size-3.5 shrink-0 text-aws-link" aria-hidden />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {loadingOperations && items.length > 0 && <li className="px-4 py-2 text-xs text-aws-muted">Loading operations...</li>}
        </ul>

        <footer className="flex items-center gap-4 border-t border-aws-border bg-aws-panel/60 px-4 py-2 text-[11px] text-aws-muted">
          <span>
            <kbd className="font-sans font-bold">↑ ↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-sans font-bold">Enter</kbd> open
          </span>
          <span>
            <kbd className="font-sans font-bold">Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}

function optionId(listId: string, itemId: string): string {
  return `${listId}-${itemId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
