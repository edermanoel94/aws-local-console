"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePreferences } from "@/stores/preferences";
import { useHydrated } from "@/hooks/use-hydrated";
import { useServices } from "@/hooks/use-queries";
import { ServiceIcon, SERVICE_SHORT_NAMES } from "@/components/aws/service-icon";
import { NAV_ITEMS, isActive } from "./navigation";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const favorites = usePreferences((s) => s.favorites);
  const { data: services } = useServices();
  const visibleFavorites = hydrated ? favorites : [];

  return (
    <aside
      className={cn(
        "sticky top-12 flex h-[calc(100vh-3rem)] shrink-0 flex-col overflow-y-auto border-r border-aws-border bg-white transition-[width] duration-150",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <nav aria-label="Main" className="px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm no-underline transition-colors",
                    active ? "bg-blue-50 font-bold text-aws-link" : "text-aws-ink hover:bg-aws-panel",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-aws-link" aria-hidden />}
                  <Icon className={cn("size-4 shrink-0", active ? "text-aws-link" : "text-aws-muted")} aria-hidden />
                  <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!collapsed && (
        <nav aria-label="Favorites" className="border-t border-aws-border px-2 py-3">
          <p className="flex items-center gap-1.5 px-3 pb-1.5 text-xs font-bold tracking-wide text-aws-muted uppercase">
            <Star className="size-3" aria-hidden /> Favorites
          </p>
          {visibleFavorites.length === 0 ? (
            <p className="px-3 text-xs leading-relaxed text-aws-muted">Star a service to pin it here.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visibleFavorites.map((id) => {
                const service = services?.find((s) => s.id === id);
                const href = `/services/${id}`;
                const active = isActive(pathname, href);
                return (
                  <li key={id}>
                    <Link
                      href={href}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg px-3 text-sm no-underline",
                        active ? "bg-blue-50 font-bold text-aws-link" : "text-aws-ink hover:bg-aws-panel",
                      )}
                    >
                      <ServiceIcon service={id} category={service?.category} size="sm" />
                      <span className="truncate">{service?.shortName ?? SERVICE_SHORT_NAMES[id] ?? id}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      )}

      <div className={cn("mt-auto border-t border-aws-border px-5 py-3 text-[11px] text-aws-muted", collapsed && "hidden")}>
        Running on <span className="font-bold text-aws-ink">Floci</span> · local AWS
      </div>
    </aside>
  );
}
